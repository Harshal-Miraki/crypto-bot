import { NextResponse } from 'next/server';
import ccxt from 'ccxt';
import nodemailer from 'nodemailer';
import { RSI, MACD, BollingerBands, SMA, EMA, ATR, StochasticRSI, ADX } from 'technicalindicators';
import { BotResponse } from '../../types';
import { BotService } from '../../lib/bot-service';
import { auth } from '../../lib/firebase';
import { signInAnonymously } from 'firebase/auth';

export const dynamic = 'force-dynamic';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const BINANCE_API_KEY  = process.env.BINANCE_API_KEY;
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

// 8 liquid symbols → more signal opportunities
const SYMBOLS = [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT',
  'XRP/USDT', 'ADA/USDT', 'AVAX/USDT', 'DOGE/USDT'
];

const TIMEFRAME        = '15m';   // Signal timeframe
const TREND_TIMEFRAME  = '1h';    // Macro trend filter
const CANDLE_LIMIT     = 250;     // ~62.5 hours of 15m data
const TREND_CANDLES    = 60;      // 60 hours of 1H data

const DAILY_TRADE_LIMIT       = 20;   // Raised from 5
const CIRCUIT_BREAKER_LOSSES  = 5;    // Raised from 3
const DAILY_LOSS_LIMIT_USD    = -300;
const FORCE_CLOSE_HOUR        = 23;   // 11 PM local

// Display threshold (= lowest setup threshold) — used for score bar on UI
const SCORE_THRESHOLD_BULL = 42;
const SCORE_THRESHOLD_BEAR = 55;

// Capital tracking (user's 1000 INR per trade)
const INR_CAPITAL = 1000;

// ─── EMAIL ───────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
});

// ─── INR RATE ────────────────────────────────────────────────────────────────
// Fetches the USDT→INR rate in priority order:
//   1. CoinDCX live ticker (exact same rate the user sees on CoinDCX)
//   2. fawazahmed0 USDT/INR currency API (USDT-specific, not generic USD)
//   3. exchangerate-api.com USD/INR (broad fallback)
//   4. Hard-coded safe fallback
async function getUSDTInrRate(): Promise<number> {
  // 1. CoinDCX public ticker — most accurate for user's comparison
  try {
    const res = await fetch('https://api.coindcx.com/exchange/ticker', {
      next: { revalidate: 300 }, // refresh every 5 min
    });
    const tickers: Array<{ market: string; last_price: string }> = await res.json();
    const usdtInr = tickers.find(t => t.market === 'USDTINR');
    const rate = usdtInr ? parseFloat(usdtInr.last_price) : NaN;
    if (rate > 60 && rate < 120) return rate; // sanity range guard
  } catch { /* fall through */ }

  // 2. fawazahmed0 USDT/INR (uses USDT, not generic USD)
  try {
    const res = await fetch(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usdt.json',
      { next: { revalidate: 300 } }
    );
    const data = await res.json();
    const rate = data?.usdt?.inr as number | undefined;
    if (rate && rate > 60 && rate < 120) return rate;
  } catch { /* fall through */ }

  // 3. exchangerate-api USD/INR (broad fallback, no key needed)
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
      next: { revalidate: 600 },
    });
    const data = await res.json();
    const rate = data?.rates?.INR as number | undefined;
    if (rate && rate > 60 && rate < 120) return rate;
  } catch { /* fall through */ }

  return 84.5; // safe hard-coded fallback (approx March 2026)
}

// ─── CORE ANALYSIS ───────────────────────────────────────────────────────────
async function analyzeAndTrade(
  symbol: string,
  exchange: any,
  USD_INR: number
): Promise<BotResponse> {

  // --- Fetch 15m candles (with retry) ---
  let candles: any[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      candles = await exchange.fetchOHLCV(symbol, TIMEFRAME, undefined, CANDLE_LIMIT);
      break;
    } catch (e: any) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  if (candles.length < 60) throw new Error(`Insufficient data for ${symbol}`);

  // --- Fetch 1H candles for trend filter (best-effort) ---
  let h1Candles: any[] = [];
  try {
    h1Candles = await exchange.fetchOHLCV(symbol, TREND_TIMEFRAME, undefined, TREND_CANDLES);
  } catch { /* no 1H trend filter if unavailable */ }

  // --- OHLCV arrays ---
  const opens   = candles.map((c: any) => c[1]);
  const highs   = candles.map((c: any) => c[2]);
  const lows    = candles.map((c: any) => c[3]);
  const closes  = candles.map((c: any) => c[4]);
  const volumes = candles.map((c: any) => c[5]);
  const currentPrice  = closes[closes.length - 1];
  const currentVolume = volumes[volumes.length - 1];

  // ── INDICATORS ───────────────────────────────────────────────────────────

  // EMA 9 / 21 / 50  (fast trend + medium trend)
  const ema9Raw  = EMA.calculate({ values: closes, period: 9 });
  const ema21Raw = EMA.calculate({ values: closes, period: 21 });
  const ema50Raw = EMA.calculate({ values: closes, period: 50 });
  const ema9Curr  = ema9Raw[ema9Raw.length - 1];
  const ema9Prev  = ema9Raw[ema9Raw.length - 2];
  const ema21Curr = ema21Raw[ema21Raw.length - 1];
  const ema21Prev = ema21Raw[ema21Raw.length - 2];
  const ema50Curr = ema50Raw[ema50Raw.length - 1];

  // EMA cross signals
  const bullishCross  = ema9Prev <= ema21Prev && ema9Curr > ema21Curr; // fresh cross up
  const bearishCross  = ema9Prev >= ema21Prev && ema9Curr < ema21Curr; // fresh cross down
  const ema9AboveEma21 = ema9Curr > ema21Curr;

  // ATR (14) — dynamic volatility measure
  const atrRaw    = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const currentATR = atrRaw[atrRaw.length - 1];

  // RSI (14)
  const rsiRaw     = RSI.calculate({ values: closes, period: 14 });
  const currentRSI = rsiRaw[rsiRaw.length - 1];
  const prevRSI    = rsiRaw[rsiRaw.length - 2] ?? currentRSI;

  // Stochastic RSI (14/14/3/3) — faster oversold detection
  const stochRSIRaw  = StochasticRSI.calculate({
    values: closes,
    rsiPeriod: 14,
    stochasticPeriod: 14,
    kPeriod: 3,
    dPeriod: 3,
  });
  const stochCurr = stochRSIRaw[stochRSIRaw.length - 1] ?? { k: 50, d: 50 };
  const stochPrev = stochRSIRaw[stochRSIRaw.length - 2] ?? { k: 50, d: 50 };
  const stochK = stochCurr.k;
  const stochD = stochCurr.d;

  // MACD (12/26/9)
  const macdRaw   = MACD.calculate({
    values: closes,
    fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false,
  });
  const macdCurr     = macdRaw[macdRaw.length - 1];
  const macdPrev     = macdRaw[macdRaw.length - 2];
  const macdHist     = macdCurr?.histogram ?? 0;
  const prevMacdHist = macdPrev?.histogram  ?? 0;
  const macdVal      = macdCurr?.MACD       ?? 0;
  const macdSig      = macdCurr?.signal     ?? 0;

  // Bollinger Bands (20, 2σ)
  const bbRaw     = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  const bbCurr    = bbRaw[bbRaw.length - 1];
  const bbLower   = bbCurr?.lower  ?? 0;
  const bbUpper   = bbCurr?.upper  ?? 0;
  const bbMiddle  = bbCurr?.middle ?? 0;

  // Volume SMA (20)
  const volSMA       = SMA.calculate({ values: volumes, period: 20 });
  const currentVolSMA = volSMA[volSMA.length - 1];
  const volRatio     = currentVolume / currentVolSMA;

  // 1H Trend filter: price vs EMA50 on hourly chart
  let h1TrendBull = true; // default bullish if no data
  if (h1Candles.length >= 52) {
    const h1Closes = h1Candles.map((c: any) => c[4]);
    const h1EMA50  = EMA.calculate({ values: h1Closes, period: 50 });
    h1TrendBull = h1Closes[h1Closes.length - 1] > h1EMA50[h1EMA50.length - 1];
  }
  const h1Trend = h1TrendBull ? 'BULL' : 'BEAR';

  // ── STATE ─────────────────────────────────────────────────────────────────
  const activePosition = await BotService.getActivePosition(symbol);
  const stats          = await BotService.getTradingStats();

  let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  let actionTaken = 'Analyzed Market';
  let score = 0;        // confluence score — updated in entry block, used in email
  let activeSetup = ''; // winning setup name — used in actionTaken + email
  let adxVal = 20;      // ADX strength — hoisted so email section can read it
  const reasons: string[] = [];

  // Time checks
  const now    = new Date();
  const hour   = now.getHours();
  const isEOD  = hour >= FORCE_CLOSE_HOUR;

  // Safety / circuit breakers
  let limitWarning = '';
  if (stats.tradesToday >= DAILY_TRADE_LIMIT)
    limitWarning = `Daily Trade Limit (${DAILY_TRADE_LIMIT})`;
  if (stats.dailyPnL <= DAILY_LOSS_LIMIT_USD)
    limitWarning = 'Daily Loss Limit Hit';
  if (stats.consecutiveLosses >= CIRCUIT_BREAKER_LOSSES)
    limitWarning = `Circuit Breaker: ${CIRCUIT_BREAKER_LOSSES} Consecutive Losses`;

  const regime         = h1TrendBull ? 'UPTREND 🟢' : 'DOWNTREND 🔴';
  const scoreThreshold = h1TrendBull ? SCORE_THRESHOLD_BULL : SCORE_THRESHOLD_BEAR;

  // ── ATR-BASED TARGET CALCULATOR ───────────────────────────────────────────
  // Guarantees minimum % targets so user always gets 30-40 INR on ₹1000 capital
  function calcTargets(entry: number, atr: number) {
    // Stop Loss: tighter of 1.5×ATR or 1.5% (whichever is smaller loss)
    const atrSL  = entry - (1.5 * atr);
    const pctSL  = entry * 0.985;
    const sl     = Math.max(atrSL, pctSL); // max = less loss

    // TP1: larger of 2.5×ATR or 1.5% (partial exit — lock some profit)
    const atrTP1 = entry + (2.5 * atr);
    const pctTP1 = entry * 1.015;
    const tp1    = Math.max(atrTP1, pctTP1);

    // TP2 (max): larger of 5×ATR or 3% — targets ₹30 on ₹1000 capital
    const atrTP2 = entry + (5 * atr);
    const pctTP2 = entry * 1.03;
    const tp2    = Math.max(atrTP2, pctTP2);

    const stopPct = ((entry - sl) / entry * 100);
    const tp1Pct  = ((tp1 - entry) / entry * 100);
    const tp2Pct  = ((tp2 - entry) / entry * 100);

    // Estimated INR profit/loss on ₹1000 capital
    const tp1INR  = (tp1Pct / 100) * INR_CAPITAL;
    const tp2INR  = (tp2Pct / 100) * INR_CAPITAL;

    return {
      sl:      Number(sl.toFixed(6)),
      tp1:     Number(tp1.toFixed(6)),
      tp2:     Number(tp2.toFixed(6)),
      stopPct: Number(stopPct.toFixed(2)),
      tp1Pct:  Number(tp1Pct.toFixed(2)),
      tp2Pct:  Number(tp2Pct.toFixed(2)),
      tp1INR:  Number(tp1INR.toFixed(1)),
      tp2INR:  Number(tp2INR.toFixed(1)),
    };
  }

  // ── MANAGE ACTIVE POSITION ────────────────────────────────────────────────
  if (activePosition) {
    const entry   = activePosition.entry_price;
    const highest = Math.max(activePosition.highestPriceSeen ?? entry, currentPrice);
    const profitPct = (currentPrice - entry) / entry;

    let closeReason = '';

    // Update highest price seen
    if (currentPrice > (activePosition.highestPriceSeen ?? entry)) {
      await BotService.updatePosition(activePosition.id, { highestPriceSeen: currentPrice });
    }

    if (isEOD) {
      signal = 'SELL';
      closeReason = 'End of Day Force Close';
      reasons.push('Closing all positions before end of day.');

    } else if (activePosition.stopLossPrice && currentPrice <= activePosition.stopLossPrice) {
      // 1. ATR-based Stop Loss
      signal = 'SELL';
      closeReason = 'Stop Loss';
      reasons.push(`Stop Loss triggered @ $${activePosition.stopLossPrice.toFixed(4)}`);

    } else if (activePosition.targetPriceMax && currentPrice >= activePosition.targetPriceMax) {
      // 2. Full Take Profit (TP2)
      signal = 'SELL';
      closeReason = 'Max Take Profit Hit';
      const gainPct = ((currentPrice - entry) / entry * 100).toFixed(2);
      const gainINR = ((currentPrice - entry) / entry * INR_CAPITAL).toFixed(1);
      reasons.push(`TP2 Reached! +${gainPct}% ≈ ₹${gainINR} profit on ₹${INR_CAPITAL}`);

    } else if (profitPct > 0.005) {
      // 3. ATR-based Trailing Stop (only once in profit > 0.5%)
      const trailingStop = highest - (2 * currentATR);
      if (currentPrice <= trailingStop) {
        signal = 'SELL';
        closeReason = 'Trailing Stop';
        const gainPct = (profitPct * 100).toFixed(2);
        const gainINR = (profitPct * INR_CAPITAL).toFixed(1);
        reasons.push(`Trailing Stop hit. Profit locked: +${gainPct}% ≈ ₹${gainINR}`);
      }
    }

    // 4. StochRSI Overbought exit (K > 80 AND reversing)
    if (signal === 'HOLD' && stochK > 80 && stochK < stochPrev.k && stochK < stochD) {
      signal = 'SELL';
      closeReason = 'StochRSI Overbought Reversal';
      reasons.push(`StochRSI overbought & turning down (K:${stochK.toFixed(1)})`);
    }

    // 5. EMA bearish cross exit (only if still in profit)
    if (signal === 'HOLD' && bearishCross && profitPct > 0) {
      signal = 'SELL';
      closeReason = 'EMA Bearish Cross';
      reasons.push('EMA9 crossed below EMA21 — trend reversing');
    }

    // Move SL to breakeven once 1% profit reached
    if (
      signal === 'HOLD' &&
      profitPct > 0.01 &&
      activePosition.stopLossPrice !== undefined &&
      activePosition.stopLossPrice < entry
    ) {
      const breakevenSL = entry * 1.002;
      await BotService.updatePosition(activePosition.id, { stopLossPrice: breakevenSL });
      reasons.push('SL moved to breakeven (+0.2%)');
    }

    if (signal === 'SELL') {
      actionTaken = `EXECUTION: Closed (${closeReason})`;
      const result = await BotService.closePosition(activePosition.id, currentPrice, reasons.join(', '));
      if (result.pnl > 0) {
        stats.consecutiveWins   += 1;
        stats.consecutiveLosses  = 0;
        stats.lastTradeResult    = 'WIN';
      } else {
        stats.consecutiveLosses += 1;
        stats.consecutiveWins    = 0;
        stats.lastTradeResult    = 'LOSS';
      }
      stats.dailyPnL += result.pnl;
      await BotService.updateTradingStats(stats);
    }

  } else {
    // ── ENTRY LOGIC ───────────────────────────────────────────────────────

    if (limitWarning) {
      actionTaken = `SKIPPING: ${limitWarning}`;

    } else if (isEOD) {
      actionTaken = 'SKIPPING: End of Day';

    } else {
      // ── ADAPTIVE MULTI-SETUP ENGINE ───────────────────────────────────
      // Three independent setups cover every market condition:
      //   A: Oversold Bounce   — ranging / correcting markets
      //   B: Trend Momentum    — established uptrend continuation
      //   C: BB Squeeze Breakout — low-volatility compression → explosion
      // Signal fires when ANY setup clears its threshold.
      score = 0;

      // ─ Pre-calc: ADX (trend strength + direction) ─
      const adxRaw  = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
      const adxCurr = adxRaw[adxRaw.length - 1] ?? { adx: 20, pdi: 25, mdi: 25 };
      adxVal        = adxCurr.adx  ?? 20; // assign to hoisted var (used in email)
      const pdi     = adxCurr.pdi  ?? 25;
      const mdi     = adxCurr.mdi  ?? 25;
      const trendingUp = pdi > mdi;

      // ─ Pre-calc: BB Width for squeeze detection ─
      const bbWidth   = bbMiddle > 0 ? (bbUpper - bbLower) / bbMiddle : 0.05;
      const isSqueeze = bbWidth < 0.030; // < 3% of price = volatility compression

      // ─ Pre-calc: Candlestick patterns ─
      const currOpen        = opens[opens.length - 1];
      const prevOpen        = opens[opens.length - 2]  ?? currOpen;
      const prevClose       = closes[closes.length - 2] ?? currentPrice;
      const currBody        = Math.abs(currentPrice - currOpen);
      const lowerShadow     = Math.min(currentPrice, currOpen) - lows[lows.length - 1];
      const upperShadow     = highs[highs.length - 1] - Math.max(currentPrice, currOpen);
      const isBullishCandle = currentPrice > currOpen;
      // Bullish engulfing: previous bearish, current bullish, current body fully covers previous
      const isBullishEngulfing = (prevClose < prevOpen) && isBullishCandle
                               && (currOpen  < prevClose) && (currentPrice > prevOpen);
      // Hammer: long lower shadow (≥1.8× body), tiny upper shadow, bullish close
      const isHammer = lowerShadow >= 1.8 * currBody && upperShadow <= 0.8 * currBody && isBullishCandle;

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // SETUP A — OVERSOLD BOUNCE  (fires in ranging / correcting markets)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      let setupA = 0;
      const setupAR: string[] = [];

      // StochRSI momentum (0–35 pts)
      if      (stochK < 20 && stochK > stochD && stochK > stochPrev.k) { setupA += 35; setupAR.push(`StochRSI Deep Oversold & Rising (K:${stochK.toFixed(1)})`); }
      else if (stochK < 30 && stochK > stochD)                          { setupA += 25; setupAR.push(`StochRSI Oversold Zone (K:${stochK.toFixed(1)})`); }
      else if (stochK < 45 && stochK > stochD && stochK > stochPrev.k) { setupA += 16; setupAR.push(`StochRSI Turning Bullish (K:${stochK.toFixed(1)})`); }
      else if (stochK < 55 && stochK > stochD)                          { setupA +=  8; setupAR.push(`StochRSI Bullish (K:${stochK.toFixed(1)})`); }

      // RSI zone (0–25 pts)
      if      (currentRSI < 30)                          { setupA += 25; setupAR.push(`RSI Deeply Oversold (${currentRSI.toFixed(1)})`); }
      else if (currentRSI < 40)                          { setupA += 18; setupAR.push(`RSI Oversold (${currentRSI.toFixed(1)})`); }
      else if (currentRSI < 50 && currentRSI > prevRSI) { setupA += 12; setupAR.push(`RSI Rising (${currentRSI.toFixed(1)})`); }
      else if (currentRSI < 55 && currentRSI > prevRSI) { setupA +=  6; setupAR.push(`RSI Recovering (${currentRSI.toFixed(1)})`); }

      // Price at BB lower support (0–18 pts)
      if      (currentPrice <= bbLower * 1.003) { setupA += 18; setupAR.push('Price at Lower BB Support'); }
      else if (currentPrice <= bbLower * 1.012) { setupA += 10; setupAR.push('Price Near Lower BB'); }
      else if (currentPrice  < bbMiddle)         { setupA +=  4; }

      // MACD histogram turning up (0–12 pts)
      if      (macdHist > 0 && macdHist > prevMacdHist) { setupA += 12; setupAR.push('MACD Bullish Momentum'); }
      else if (macdHist > prevMacdHist)                  { setupA +=  8; setupAR.push('MACD Histogram Turning Up'); }

      // Candlestick reversal pattern (0–12 pts)
      if      (isBullishEngulfing && currentPrice < bbMiddle) { setupA += 12; setupAR.push('Bullish Engulfing Candle'); }
      else if (isHammer           && currentPrice < bbMiddle) { setupA += 10; setupAR.push('Hammer Pattern at Support'); }

      // Volume (0–8 pts)
      if      (volRatio >= 1.5) { setupA += 8; setupAR.push(`Volume Surge (${volRatio.toFixed(1)}x)`); }
      else if (volRatio >= 1.2) { setupA += 4; }

      const threshA = h1TrendBull ? 42 : 55;

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // SETUP B — TREND MOMENTUM  (fires in established uptrends)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      let setupB = 0;
      const setupBR: string[] = [];

      // EMA alignment (0–30 pts)
      if      (bullishCross)                                                                    { setupB += 30; setupBR.push('EMA9 × EMA21 Fresh Bullish Cross 🎯'); }
      else if (ema9Curr > ema21Curr && ema21Curr > ema50Curr && currentPrice > ema50Curr)      { setupB += 25; setupBR.push('Full EMA Bullish Stack (9>21>50)'); }
      else if (ema9Curr > ema21Curr && currentPrice > ema21Curr)                               { setupB += 15; setupBR.push('EMA9 > EMA21 Bullish'); }

      // ADX trend strength (0–20 pts)
      if      (adxVal > 30 && trendingUp) { setupB += 20; setupBR.push(`Strong Uptrend ADX(${adxVal.toFixed(0)})`); }
      else if (adxVal > 20 && trendingUp) { setupB += 12; setupBR.push(`Trending Up ADX(${adxVal.toFixed(0)})`); }
      else if (trendingUp)                { setupB +=  6; setupBR.push('+DI > -DI Bullish'); }

      // MACD momentum (0–25 pts)
      if      (macdHist > 0 && macdHist > prevMacdHist) { setupB += 25; setupBR.push('MACD Strong Bullish Momentum'); }
      else if (macdHist > 0)                             { setupB += 15; setupBR.push('MACD Positive'); }
      else if (macdVal > macdSig && macdHist > prevMacdHist) { setupB += 8; setupBR.push('MACD Crossing Bullish'); }

      // 1H trend aligned (0–15 pts)
      if (h1TrendBull) { setupB += 15; setupBR.push('1H Trend: BULLISH'); }

      // Volume conviction (0–10 pts)
      if      (volRatio >= 2.0) { setupB += 10; setupBR.push(`Volume Surge (${volRatio.toFixed(1)}x)`); }
      else if (volRatio >= 1.5) { setupB +=  6; }
      else if (volRatio >= 1.2) { setupB +=  3; }

      const threshB = h1TrendBull ? 52 : 70;

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // SETUP C — BB SQUEEZE BREAKOUT  (low-volatility compression → explosion)
      // Bollinger Band squeeze = coiled spring; trade direction = momentum
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      let setupC = 0;
      const setupCR: string[] = [];

      if (isSqueeze) {
        setupC += 30; setupCR.push(`BB Squeeze Active (Width:${(bbWidth * 100).toFixed(2)}%) — Breakout Imminent`);
        if (ema9Curr > ema21Curr)                           { setupC += 20; setupCR.push('Bullish EMA Bias'); }
        if (stochK > stochPrev.k && stochK > stochD)       { setupC += 15; setupCR.push('StochRSI Momentum Up'); }
        if (macdHist > prevMacdHist)                        { setupC += 20; setupCR.push('MACD Momentum Building'); }
        if (volRatio >= 1.3)                                { setupC += 15; setupCR.push(`Volume Building (${volRatio.toFixed(1)}x)`); }
        if (currentRSI > prevRSI && currentRSI < 65)       { setupC += 10; setupCR.push('RSI Momentum Positive'); }
      }

      const threshC = h1TrendBull ? 62 : 80;

      // ─ Pick winning setup & build final score ─────────────────────────────
      const setupAFired = setupA >= threshA;
      const setupBFired = setupB >= threshB;
      const setupCFired = setupC >= threshC;
      const anySetupFired = setupAFired || setupBFired || setupCFired;

      // Normalize each setup to 0-100 for display
      const normA = Math.min(Math.round((setupA / 110) * 100), 100);
      const normB = Math.min(Math.round((setupB / 100) * 100), 100);
      const normC = isSqueeze ? Math.min(Math.round((setupC / 110) * 100), 100) : 0;
      score = Math.max(normA, normB, normC);

      activeSetup = 'WATCHING'; // assign to hoisted var (used in email)
      if (setupCFired) {
        activeSetup = 'SQUEEZE BREAKOUT'; reasons.push(...setupCR.slice(0, 4));
      } else if (setupBFired && setupAFired) {
        activeSetup = 'TREND + BOUNCE';   reasons.push(...setupBR.slice(0, 2), ...setupAR.slice(0, 2));
      } else if (setupBFired) {
        activeSetup = 'TREND MOMENTUM';   reasons.push(...setupBR.slice(0, 4));
      } else if (setupAFired) {
        activeSetup = 'OVERSOLD BOUNCE';  reasons.push(...setupAR.slice(0, 4));
      } else {
        // No setup fired — show best partial for dashboard info
        if (normA >= normB && normA >= normC) reasons.push(...setupAR.slice(0, 2));
        else if (normB >= normC)              reasons.push(...setupBR.slice(0, 2));
        else                                  reasons.push(...setupCR.slice(0, 2));
      }

      // ── ENTRY DECISION ────────────────────────────────────────────────────
      if (anySetupFired) {
        signal = 'BUY';

        // Capital: 1000 INR, adjusted for streak
        let riskMultiplier = 1.0;
        if (stats.consecutiveWins  >= 3) riskMultiplier = 1.3; // hot streak: +30%
        if (stats.consecutiveWins  >= 2) riskMultiplier = 1.15;
        if (stats.consecutiveLosses >= 3) riskMultiplier = 0.6; // cold streak: -40%
        if (stats.consecutiveLosses >= 2) riskMultiplier = 0.8;

        const capitalINR = INR_CAPITAL * riskMultiplier;
        const capitalUSD = capitalINR / USD_INR;
        const quantity   = Number((capitalUSD / currentPrice).toFixed(8));

        // ATR + % hybrid targets (guarantees ₹30 min at TP2)
        const t = calcTargets(currentPrice, currentATR);

        await BotService.openPosition(
          symbol, currentPrice, quantity,
          t.sl, t.tp1, t.tp2
        );

        actionTaken = `EXECUTION: BUY ₹${capitalINR.toFixed(0)} | [${activeSetup}] Score ${score}/100`;
        reasons.push(
          `SL: $${t.sl.toFixed(4)} (-${t.stopPct}% ≈ -₹${(t.stopPct / 100 * capitalINR).toFixed(1)})`,
          `TP1: $${t.tp1.toFixed(4)} (+${t.tp1Pct}% ≈ +₹${(t.tp1Pct / 100 * capitalINR).toFixed(1)})`,
          `TP2: $${t.tp2.toFixed(4)} (+${t.tp2Pct}% ≈ +₹${(t.tp2Pct / 100 * capitalINR).toFixed(1)})`
        );

        stats.tradesToday += 1;
        await BotService.updateTradingStats(stats);
      } else {
        actionTaken = `WATCHING: [A:${setupA}/${threshA} B:${setupB}/${threshB} C:${setupC}/${threshC}] Score ${score}/100`;
      }
    }
  }

  // ── EMAIL NOTIFICATION ────────────────────────────────────────────────────
  const priceINR  = currentPrice * USD_INR;
  const shouldEmail = signal !== 'HOLD';

  if (shouldEmail && EMAIL_USER && EMAIL_PASS) {
    let bodySection = '';
    if (signal === 'BUY') {
      const t = calcTargets(currentPrice, currentATR);
      bodySection = `
═══════════════════════════════
📈 BUY SIGNAL — ${symbol}  [${activeSetup}]
═══════════════════════════════
Price:  $${currentPrice.toLocaleString()} | ₹${priceINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
Trend:  ${regime} (1H) | ATR: $${currentATR.toFixed(4)} | ADX: ${adxVal.toFixed(0)}

🎯 TARGETS (on ₹${INR_CAPITAL} capital):
  Stop Loss : $${t.sl.toFixed(4)}  (-${t.stopPct}% | -₹${(t.stopPct / 100 * INR_CAPITAL).toFixed(1)})
  TP1 (50%) : $${t.tp1.toFixed(4)} (+${t.tp1Pct}% | +₹${t.tp1INR})  ← Take half here
  TP2 (full): $${t.tp2.toFixed(4)} (+${t.tp2Pct}% | +₹${t.tp2INR})  ← Target zone

📊 INDICATORS:
  StochRSI K: ${stochK.toFixed(1)} | D: ${stochD.toFixed(1)}
  RSI: ${currentRSI.toFixed(1)} | MACD Hist: ${macdHist.toFixed(6)}
  EMA9/21: ${ema9AboveEma21 ? 'BULLISH ✅' : 'BEARISH ❌'} | ${bullishCross ? '🚀 FRESH CROSS!' : ''}
  Volume: ${volRatio.toFixed(1)}x average

Signal Strength: ${score ?? '—'}/100
Reasons: ${reasons.slice(0, 4).join(' | ')}
`;
    } else if (signal === 'SELL') {
      const pnlUSD = activePosition
        ? (currentPrice - activePosition.entry_price) * activePosition.quantity
        : 0;
      const pnlINR = pnlUSD * USD_INR;
      bodySection = `
═══════════════════════════════
📉 SELL SIGNAL — ${symbol}
═══════════════════════════════
Exit Price: $${currentPrice.toLocaleString()} | ₹${priceINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
PnL: ${pnlINR >= 0 ? '+' : ''}₹${pnlINR.toFixed(1)} | ${pnlUSD >= 0 ? '+' : ''}$${pnlUSD.toFixed(4)}

Reason: ${reasons.join(' | ')}
`;
    }

    const subject = `${signal === 'BUY' ? '🟢 BUY' : '🔴 SELL'} ${symbol} @ ₹${priceINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
    await transporter.sendMail({
      from: EMAIL_USER,
      to: EMAIL_USER,
      subject,
      text: bodySection,
    });
  }

  // ── MANUAL TRADE ALERTS ───────────────────────────────────────────────────
  try {
    const manualTrades = await BotService.getManualTrades();
    if (signal === 'SELL') {
      for (const mt of manualTrades.filter(t => t.symbol === symbol)) {
        const pnlPct = ((currentPrice - mt.entryPrice) / mt.entryPrice * 100).toFixed(2);
        await transporter.sendMail({
          from: EMAIL_USER,
          to: EMAIL_USER,
          subject: `⚠️ MANUAL TRADE ALERT: SELL ${symbol} (${pnlPct}%)`,
          text: `Bot detected SELL for ${symbol}.\nYour entry: $${mt.entryPrice}\nCurrent: $${currentPrice}\nPnL: ${pnlPct}%\nReason: ${reasons.join(', ')}`,
        });
      }
    }
  } catch { /* non-critical */ }

  await BotService.log('INFO', `${symbol}: ${signal} | ${regime} | Score: — | ${actionTaken}`, {
    symbol, rsi: currentRSI, stochK, ema9AboveEma21, h1Trend,
  });

  // ── FORECAST ENGINE ───────────────────────────────────────────────────────
  // Uses StochRSI velocity for more responsive predictions than plain RSI
  const stochVelocity  = stochK - stochPrev.k;
  const rsiVelocity    = Number((currentRSI - prevRSI).toFixed(2));
  let forecast = {
    prediction: 'Market Watching',
    timeFrame: 'Indefinite',
    velocity: rsiVelocity,
    trend: 'neutral' as 'bullish' | 'bearish' | 'neutral',
  };

  if (stochK < 50 && stochVelocity < -1) {
    const distanceToBuy = stochK - 20;
    forecast.trend = 'bearish';
    if (distanceToBuy > 0) {
      const candles = distanceToBuy / Math.abs(stochVelocity);
      const mins = Math.ceil(candles * 15);
      if (mins < 240) {
        const h = Math.floor(mins / 60), m = mins % 60;
        forecast.prediction = '📉 Approaching Buy Zone';
        forecast.timeFrame  = h > 0 ? `~${h}h ${m}m` : `~${mins}m`;
      }
    }
  } else if (stochK > 50 && stochVelocity > 1) {
    const distanceToSell = 80 - stochK;
    forecast.trend = 'bullish';
    if (distanceToSell > 0) {
      const candles = distanceToSell / stochVelocity;
      const mins = Math.ceil(candles * 15);
      if (mins < 240) {
        const h = Math.floor(mins / 60), m = mins % 60;
        forecast.prediction = '🚀 Approaching Sell Zone';
        forecast.timeFrame  = h > 0 ? `~${h}h ${m}m` : `~${mins}m`;
      }
    }
  }

  // ── RETURN PAYLOAD ────────────────────────────────────────────────────────
  const targets = calcTargets(currentPrice, currentATR);
  return {
    symbol,
    price:      currentPrice,
    rsi:        currentRSI,
    signal,
    emailSent:  shouldEmail,
    timestamp:  new Date().toISOString(),
    inrRate:    USD_INR,
    activePosition: activePosition
      ? {
          entryPrice:      activePosition.entry_price,
          pnl:             (currentPrice - activePosition.entry_price) * activePosition.quantity,
          pnlINR:          (currentPrice - activePosition.entry_price) * activePosition.quantity * USD_INR,
          status:          activePosition.status,
          stopLossPrice:   activePosition.stopLossPrice,
          takeProfitLevel1: activePosition.takeProfitLevel1,
          targetPriceMax:  activePosition.targetPriceMax,
        }
      : null,
    analysis: {
      macd:     { MACD: macdVal, signal: macdSig, histogram: macdHist },
      bollinger: { upper: bbUpper, middle: bbMiddle, lower: bbLower },
      volume:   { isHigh: volRatio >= 1.5, average: currentVolSMA, current: currentVolume },
      stochRSI: { k: stochK, d: stochD },
      ema:      { ema9: ema9Curr, ema21: ema21Curr, ema50: ema50Curr, bullishCross },
      atr:      currentATR,
      h1Trend,
    },
    confluenceScore: score, // 0 when managing active position, computed score when evaluating entry
    scoreThreshold,
    targets: {
      stopLoss: targets.sl,
      tp1:      targets.tp1,
      tp2:      targets.tp2,
      stopPct:  targets.stopPct,
      tp1Pct:   targets.tp1Pct,
      tp2Pct:   targets.tp2Pct,
      tp1INR:   targets.tp1INR,
      tp2INR:   targets.tp2INR,
    },
    forecast,
  } as BotResponse;
}

// ─── GET HANDLER ─────────────────────────────────────────────────────────────
export async function GET() {
  try {
    if (!auth.currentUser) {
      try { await signInAnonymously(auth); } catch { /* non-critical */ }
    }

    if (!EMAIL_USER || !EMAIL_PASS) {
      return NextResponse.json({ error: 'Missing email env vars.' }, { status: 500 });
    }

    const exchange = new ccxt.binance({
      apiKey:          BINANCE_API_KEY,
      secret:          BINANCE_SECRET_KEY,
      timeout:         30000,
      enableRateLimit: true,
    });

    const USD_INR = await getUSDTInrRate();
    const results: BotResponse[] = [];

    // Run sequentially to respect rate limits
    for (const symbol of SYMBOLS) {
      try {
        results.push(await analyzeAndTrade(symbol, exchange, USD_INR));
      } catch (err: any) {
        console.error(`Error processing ${symbol}:`, err.message);
        results.push({
          symbol, price: 0, rsi: 0,
          signal: 'HOLD', emailSent: false,
          timestamp: new Date().toISOString(),
          error: err.message,
        });
      }
    }

    // Prune logs older than 3 hours
    try { await BotService.pruneOldLogs(3); } catch { /* non-critical */ }

    return NextResponse.json(results);

  } catch (error: any) {
    console.error('Bot fatal error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

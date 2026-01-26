import { NextResponse } from 'next/server';
import ccxt from 'ccxt';
import nodemailer from 'nodemailer';
import { RSI, MACD, BollingerBands, SMA, EMA, ATR } from 'technicalindicators';
import { BotResponse } from '../../types';
import { BotService } from '../../lib/bot-service';
import { auth } from '../../lib/firebase';
import { signInAnonymously } from 'firebase/auth';

export const dynamic = 'force-dynamic';

// Environment variables
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

const SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
const TIMEFRAME = '15m'; // INTRADAY
const RSI_PERIOD = 14;
const FORCE_CLOSE_HOUR = 23; // 11 PM Local Time

// Email Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
});

async function getUSDTInrRate() {
    try {
        const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', { next: { revalidate: 3600 } }); 
        const data = await res.json();
        const baseRate = data.rates.INR;
        return baseRate * 1.020; // +2% Premium for CoinDCX
    } catch (error) {
        console.warn('Failed to fetch INR rate, using fallback:', error);
        return 88.0 * 1.020; // Fallback with premium
    }
}

async function analyzeAndTrade(symbol: string, exchange: any, USD_INR: number) {
    let candles;
    // Retry logic for fetching data
    for (let i = 0; i < 3; i++) {
        try {
            candles = await exchange.fetchOHLCV(symbol, TIMEFRAME, undefined, 200);
            break;
        } catch (e: any) {
            console.warn(`Attempt ${i+1} failed for ${symbol}:`, e.message);
            if (i === 2) throw e;
            await new Promise(res => setTimeout(res, 2000));
        }
    }

    if (!candles || candles.length < 50) {
       throw new Error(`Not enough data for ${symbol}`);
    }

    // Helper: High/Low/Close arrays
    const highs = candles.map((c: any) => c[2]);
    const lows = candles.map((c: any) => c[3]);
    const closes = candles.map((c: any) => c[4]);
    const volumes = candles.map((c: any) => c[5]);
    
    const currentPrice = closes[closes.length - 1];
    const currentVolume = volumes[volumes.length - 1];

    // --- INDICATORS ---
    // Trend (EMA 50)
    const ema50Values = EMA.calculate({ values: closes, period: 50 });
    const currentEMA50 = ema50Values[ema50Values.length - 1];

    // Volatility (ATR 14)
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const currentATR = atrValues[atrValues.length - 1];
    const avgATR = atrValues.slice(-20).reduce((a, b) => a + b, 0) / 20;

    const isDowntrend = currentPrice < currentEMA50;
    const isHighVolatility = currentATR > (avgATR * 1.5);

    // RSI
    const rsiValues = RSI.calculate({ values: closes, period: RSI_PERIOD });
    const currentRSI = rsiValues[rsiValues.length - 1];

    // MACD
    const macdValues = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const currentMACD = macdValues[macdValues.length - 1];

    // Bollinger
    const bbValues = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
    const currentBB = bbValues[bbValues.length - 1];

    // Volume SMA
    const volumeSMA = SMA.calculate({ values: volumes, period: 20 });
    const currentVolSMA = volumeSMA[volumeSMA.length - 1];
    const isHighVolume = currentVolume > currentVolSMA;

    // --- LOGIC ---
    const activePosition = await BotService.getActivePosition(symbol);
    const stats = await BotService.getTradingStats(); // Note via loop this might race if parallel, but we call sequential

    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let actionTaken = 'Analyzed Market';
    let reasons: string[] = [];

    const macdHist = currentMACD?.histogram || 0;
    const macdVal = currentMACD?.MACD || 0;
    const macdSig = currentMACD?.signal || 0;
    const bbLower = currentBB?.lower || 0;
    const bbUpper = currentBB?.upper || 0;

    // Filters
    const now = new Date();
    const hour = now.getHours(); 
    const utcHour = now.getUTCHours(); 
    const isUSOpen = utcHour === 13 || utcHour === 14; 
    let timeSafetyWarning = '';
    if (isUSOpen) timeSafetyWarning = 'US OPEN (High Volatility)';
    const isEOD = hour >= FORCE_CLOSE_HOUR;
    if (isEOD) timeSafetyWarning = 'END OF DAY (Force Close)';

    const regime = isDowntrend ? 'DOWNTREND 🔴' : 'UPTREND 🟢';
    const volatility = isHighVolatility ? 'HIGH VOLATILITY ⚠️' : 'Normal';
    
    let limitWarning = '';
    if (stats.tradesToday >= 5) limitWarning = 'Daily Trade Limit Reached (5/5)'; 
    if (stats.dailyPnL <= -300) limitWarning = 'Daily Loss Limit Hit (-$300)';
    if (stats.consecutiveLosses >= 3) limitWarning = 'Circuit Breaker: 3 Consecutive Losses';

    if (activePosition) {
        // --- MANAGE ACTIVE POSITION ---
        let closeReason = '';
        if (isEOD) {
             signal = 'SELL';
             closeReason = 'End of Day Exit';
             reasons.push('Force closing all positions before sleep.');
        } else {
             if (activePosition.stopLossPrice && currentPrice <= activePosition.stopLossPrice) {
                closeReason = 'Stop Loss';
                signal = 'SELL';
                reasons.push(`STOP LOSS HIT ($${activePosition.stopLossPrice})`);
             } else {
                const highest = activePosition.highestPriceSeen || activePosition.entry_price;
                if (currentPrice > highest) {
                    await BotService.updatePosition(activePosition.id, { highestPriceSeen: currentPrice });
                    const profitPct = (currentPrice - activePosition.entry_price) / activePosition.entry_price;
                    if (profitPct > 0.01 && (activePosition.stopLossPrice === undefined || activePosition.stopLossPrice < activePosition.entry_price)) {
                        const newSL = Number((activePosition.entry_price * 1.002).toFixed(2));
                         await BotService.updatePosition(activePosition.id, { stopLossPrice: newSL });
                         reasons.push('Moved SL to Breakeven');
                    }
                }
                const trailingStopLevel = Number((highest * 0.985).toFixed(2));
                if (currentPrice <= trailingStopLevel && currentPrice > activePosition.entry_price) {
                     closeReason = 'Trailing Stop (Trend Reversal)';
                     signal = 'SELL';
                     reasons.push(`Trailing Stop Hit ($${trailingStopLevel}) - Secured Profit`);
                }
                const isRsiOverbought = currentRSI > 75; 
                const isMacdBearish = macdHist < 0;
                if (isRsiOverbought && isMacdBearish) {
                    signal = 'SELL';
                    closeReason = 'Indicator Exit';
                    reasons.push('RSI Overbought (>75)', 'MACD Bearish flip');
                } else if (currentPrice >= bbUpper) {
                    reasons.push('Hit Upper Bollinger Band (Watch for exit)');
                }
             }
             if (signal === 'SELL' && !actionTaken.startsWith('EXECUTION')) {
                 actionTaken = `EXECUTION: Closed (${closeReason})`;
             }
        }

        if (signal === 'SELL') {
             if (!actionTaken.startsWith('EXECUTION')) actionTaken = 'EXECUTION: Closed';
             const result = await BotService.closePosition(activePosition.id, currentPrice, reasons.join(', '));
             const tradePnL = result.pnl;
             stats.dailyPnL += tradePnL;
             if (tradePnL > 0) {
                 stats.consecutiveWins += 1;
                 stats.consecutiveLosses = 0;
                 stats.lastTradeResult = 'WIN';
             } else {
                 stats.consecutiveLosses += 1;
                 stats.consecutiveWins = 0;
                 stats.lastTradeResult = 'LOSS';
             }
             await BotService.updateTradingStats(stats);
        }
    } else {
        // --- MANAGE ENTRY ---
        if (limitWarning) { actionTaken = `SKIPPING: ${limitWarning}`; }
        else if (isEOD) { actionTaken = `SKIPPING: ${timeSafetyWarning}`; }
        else if (isDowntrend) { actionTaken = 'SKIPPING: Market in Downtrend (< EMA 50)'; } 
        else if (isHighVolatility) { actionTaken = 'SKIPPING: High Volatility (ATR)'; }
        else if (timeSafetyWarning) { actionTaken = `SKIPPING: ${timeSafetyWarning}`; }
        else {
            let score = 0;
            const isRsiOversold = currentRSI < 30; 
            const isMacdBullish = macdHist > 0 && macdVal > macdSig;
            const isNearLowerBand = currentPrice <= bbLower * 1.01; 
            if (isRsiOversold) score += 35;
            if (isMacdBullish) score += 30;
            if (isNearLowerBand) score += 20;
            if (isHighVolume) score += 15;
            const SCORE_THRESHOLD = 70;

            if (score >= SCORE_THRESHOLD) {
                reasons.push(`Confluence Score: ${score}/100`);
                signal = 'BUY';
                let riskUSD = 100; // Base Risk
                if (stats.consecutiveWins >= 2) riskUSD = 120; 
                if (stats.consecutiveLosses >= 2) riskUSD = 60; 
                const quantity = Number((riskUSD / currentPrice).toFixed(5));

                // Calculate Targets
                const targetConservative = currentPrice * 1.02; // 2%
                // Aggressive: Upper Band or 4% fallback
                let targetMax = bbUpper > currentPrice ? bbUpper : currentPrice * 1.04;
                // Ensure targetMax is at least higher than conservative
                if (targetMax <= targetConservative) targetMax = currentPrice * 1.05;

                await BotService.openPosition(symbol, currentPrice, quantity, Number(targetMax.toFixed(2)));
                
                actionTaken = `EXECUTION: Opened Long ($${riskUSD})`;
                reasons.push(`Target 1: $${targetConservative.toFixed(2)}`, `Max Target: $${targetMax.toFixed(2)}`);
                
                stats.tradesToday += 1;
                await BotService.updateTradingStats(stats);
            } else {
                actionTaken = `WATCHING: Score ${score}/100`;
                if (isRsiOversold) reasons.push('RSI Oversold but low confluence');
            }
        }
    }

    // Email Logic
    const priceINR = currentPrice * USD_INR;
    const shouldEmail = (signal !== 'HOLD') || (activePosition !== null && Math.abs((currentPrice - activePosition.entry_price)/activePosition.entry_price) > 0.05);

    if (shouldEmail && EMAIL_USER && EMAIL_PASS) {
        
        let targetSection = '';
        if (signal === 'BUY') {
             const targetConservative = currentPrice * 1.02;
             let targetMax = bbUpper > currentPrice ? bbUpper : currentPrice * 1.04;
             if (targetMax <= targetConservative) targetMax = currentPrice * 1.05;

             targetSection = `
               ---------------------------
               🎯 SELL TARGETS (Profit Maximization)
               
               1. Conservative Exit (2%): $${targetConservative.toFixed(2)} (₹${(targetConservative * USD_INR).toLocaleString('en-IN', {maximumFractionDigits: 0})})
               2. Max Profit Target:      $${targetMax.toFixed(2)} (₹${(targetMax * USD_INR).toLocaleString('en-IN', {maximumFractionDigits: 0})})
               
               Tip: Move Stop Loss to Breakeven once Target 1 is hit.
             `;
        }

        const mailOptions = {
            from: EMAIL_USER,
            to: EMAIL_USER,
            subject: `Bot ${signal}: ${symbol} @ $${currentPrice.toLocaleString()} (₹${priceINR.toLocaleString('en-IN', {maximumFractionDigits: 0})})`,
            text: `
              Price: $${currentPrice.toLocaleString()} | ₹${priceINR.toLocaleString('en-IN', {maximumFractionDigits: 2})}
              Action: ${actionTaken}
              Regime: ${regime} | ${volatility}
              Time Check: ${timeSafetyWarning || 'Safe'}
              Reasons: ${reasons.join(', ') || 'Holding'}
              ${targetSection}
              ---------------------------
              RSI: ${currentRSI.toFixed(2)}
              MACD: ${macdHist.toFixed(4)}
              Volume: ${isHighVolume ? 'HIGH' : 'Normal'}
            `,
        };
        await transporter.sendMail(mailOptions);
    }

    // Check Manual Trades
    try {
        const manualTrades = await BotService.getManualTrades();
        const activeManuals = manualTrades.filter(mt => mt.symbol === symbol);
        
        if (signal === 'SELL' && activeManuals.length > 0) {
            for (const mt of activeManuals) {
                 const pnl = ((currentPrice - mt.entryPrice) / mt.entryPrice) * 100;
                 const mailOptions = {
                    from: EMAIL_USER,
                    to: EMAIL_USER,
                    subject: `⚠️ MANUAL TRADE ALERT: SELL ${symbol} (PnL: ${pnl.toFixed(2)}%)`,
                    text: `
                      Manual Trade Alert!
                      
                      The bot has detected a SELL Signal for ${symbol}.
                      You are manually tracking this coin.
                      
                      Your Entry: $${mt.entryPrice}
                      Current Price: $${currentPrice}
                      Profit/Loss: ${pnl.toFixed(2)}%
                      
                      Advice: Consider closing your manual position now.
                      Reason: ${reasons.join(', ')}
                    `
                };
                if (EMAIL_USER && EMAIL_PASS) await transporter.sendMail(mailOptions);
            }
        }
    } catch(e) { console.error('Manual trade check failed', e); }

    await BotService.log('INFO', `${symbol}: ${signal} | ${regime} | ${actionTaken}`, { rsi: currentRSI, symbol });

    // --- FORECAST ENGINE ---
    const prevRSI = rsiValues[rsiValues.length - 2] || currentRSI;
    const rsiVelocity = Number((currentRSI - prevRSI).toFixed(2));
    
    let forecast = {
        prediction: 'Market Stagnant',
        timeFrame: 'Indefinite',
        velocity: rsiVelocity,
        trend: 'neutral' as 'bullish' | 'bearish' | 'neutral'
    };

    if (rsiVelocity <= -0.5) { // Dropping Fast (Bearish toward Buy)
        const distanceToBuy = currentRSI - 30;
        forecast.trend = 'bearish';
        if (distanceToBuy > 0 && distanceToBuy < 40) { // Only if reasonable range
            const candles = distanceToBuy / Math.abs(rsiVelocity);
            const mins = Math.ceil(candles * 15);
             if (mins < 300) { // Only show if within 5 hours
                forecast.prediction = `📉 Approaching Buy Zone`;
                const hours = Math.floor(mins / 60);
                const remainingMins = mins % 60;
                forecast.timeFrame = hours > 0 ? `~${hours}h ${remainingMins}m` : `~${mins}m`;
             }
        }
    } else if (rsiVelocity >= 0.5) { // Rising (Bullish toward Sell)
         const distanceToSell = 75 - currentRSI;
         forecast.trend = 'bullish';
         if (distanceToSell > 0 && distanceToSell < 40) {
            const candles = distanceToSell / rsiVelocity;
            const mins = Math.ceil(candles * 15);
            if (mins < 300) {
                forecast.prediction = `🚀 Approaching Sell Zone`;
                const hours = Math.floor(mins / 60);
                const remainingMins = mins % 60;
                forecast.timeFrame = hours > 0 ? `~${hours}h ${remainingMins}m` : `~${mins}m`;
            }
         }
    }

    return {
      symbol: symbol,
      price: currentPrice,
      rsi: currentRSI,
      signal,
      emailSent: shouldEmail,
      timestamp: new Date().toISOString(),
      inrRate: USD_INR,
      activePosition: activePosition ? {
          entryPrice: activePosition.entry_price,
          pnl: (currentPrice - activePosition.entry_price) * activePosition.quantity,
          status: activePosition.status
      } : null,
      analysis: {
          macd: { MACD: macdVal, signal: macdSig, histogram: macdHist },
          bollinger: { upper: bbUpper, middle: currentBB?.middle || 0, lower: bbLower },
          volume: { isHigh: isHighVolume, average: currentVolSMA, current: currentVolume }
      },
      forecast: forecast
    };
}

export async function GET() {
  try {
    if (!auth.currentUser) {
        try { await signInAnonymously(auth); } 
        catch (e: any) { console.error('Auth Error:', e.message); }
    }

    if (!EMAIL_USER || !EMAIL_PASS) {
      return NextResponse.json({ error: 'Missing environment variables.' }, { status: 500 });
    }

    const exchange = new ccxt.binance({
      apiKey: BINANCE_API_KEY,
      secret: BINANCE_SECRET_KEY,
      timeout: 30000, 
      enableRateLimit: true,
    });

    const USD_INR = await getUSDTInrRate();
    
    // Analyze all symbols sequentially to avoid rate limits / race conditions
    const results: BotResponse[] = [];
    for (const symbol of SYMBOLS) {
        try {
            const result = await analyzeAndTrade(symbol, exchange, USD_INR);
            results.push(result);
        } catch (err: any) {
            console.error(`Error processing ${symbol}:`, err);
            // Push an error response for this symbol so frontend knows it failed
            results.push({
                symbol,
                price: 0,
                rsi: 0,
                signal: 'HOLD',
                emailSent: false,
                timestamp: new Date().toISOString(),
                error: err.message
            });
        }
    }

    // Prune logs older than 3 hours
    try { await BotService.pruneOldLogs(3); } catch (e) { console.error('Pruning error', e) }

    return NextResponse.json(results); // Returns Array

  } catch (error: any) {
    console.error('Bot Error:', error);
    return NextResponse.json({ error: error.message || 'An error occurred' }, { status: 500 });
  }
}

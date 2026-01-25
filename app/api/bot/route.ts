import { NextResponse } from 'next/server';
import ccxt from 'ccxt';
import nodemailer from 'nodemailer';
import { RSI, MACD, BollingerBands, SMA, EMA, ATR } from 'technicalindicators';
import axios from 'axios';
import { BotResponse } from '../../types';
import { BotService, Position } from '../../lib/bot-service';

// Environment variables
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

const SYMBOL = 'BTC/USDT';
const TIMEFRAME = '1h';
const RSI_PERIOD = 14;

// Email Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
});

async function getUSDTInrRate(): Promise<number> {
    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=inr');
        return response.data.tether.inr;
    } catch (error) {
        console.error('Error fetching USDT rate:', error);
        return 88; 
    }
}

export async function GET() {
  try {
    if (!EMAIL_USER || !EMAIL_PASS) {
      return NextResponse.json(
        { error: 'Missing environment variables.' },
        { status: 500 }
      );
    }

    // 1. Initialize Exchange
    const exchange = new ccxt.binance({
      apiKey: BINANCE_API_KEY,
      secret: BINANCE_SECRET_KEY,
    });

    // 2. Fetch Data (Need more candles for MACD/EMA/Bollinger)
    const candles = await exchange.fetchOHLCV(SYMBOL, TIMEFRAME, undefined, 200);
    if (!candles || candles.length < 50) {
       return NextResponse.json({ error: 'Not enough data' }, { status: 500 });
    }

    // Helper: High/Low/Close arrays
    const highs = candles.map((c: any) => c[2]);
    const lows = candles.map((c: any) => c[3]);
    const closes = candles.map((c: any) => c[4]);
    const volumes = candles.map((c: any) => c[5]);
    
    const currentPrice = closes[closes.length - 1];
    const currentVolume = volumes[volumes.length - 1];

    // 3. Technical Indicators
    
    // Trend (EMA 50)
    const ema50Values = EMA.calculate({ values: closes, period: 50 });
    const currentEMA50 = ema50Values[ema50Values.length - 1];

    // Volatility (ATR 14)
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const currentATR = atrValues[atrValues.length - 1];
    // Calculate Average ATR (last 20 periods of ATR)
    const avgATR = atrValues.slice(-20).reduce((a, b) => a + b, 0) / 20;

    const isDowntrend = currentPrice < currentEMA50;
    const isHighVolatility = currentATR > (avgATR * 1.5);

    // RSI
    const rsiValues = RSI.calculate({ values: closes, period: RSI_PERIOD });
    const currentRSI = rsiValues[rsiValues.length - 1];

    // MACD (12, 26, 9)
    const macdValues = MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    });
    const currentMACD = macdValues[macdValues.length - 1];

    // Bollinger Bands (20, 2)
    const bbValues = BollingerBands.calculate({
        values: closes,
        period: 20,
        stdDev: 2
    });
    const currentBB = bbValues[bbValues.length - 1];

    // Volume Analysis (20 SMA)
    const volumeSMA = SMA.calculate({ values: volumes, period: 20 });
    const currentVolSMA = volumeSMA[volumeSMA.length - 1];
    const isHighVolume = currentVolume > currentVolSMA;

    // 4. Confluence Signal Logic
    const activePosition = await BotService.getActivePosition(SYMBOL);
    
    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let actionTaken = 'Analyzed Market';
    let reasons: string[] = [];

    const macdHist = currentMACD?.histogram || 0;
    const macdVal = currentMACD?.MACD || 0;
    const macdSig = currentMACD?.signal || 0;
    const bbLower = currentBB?.lower || 0;
    const bbUpper = currentBB?.upper || 0;

    // --- TIME-BASED FILTER ---
    const now = new Date();
    const hour = now.getUTCHours(); 
    // Weekend: Sat(6), Sun(0)
    // const isWeekend = now.getUTCDay() === 0 || now.getUTCDay() === 6;
    const isWeekend = false; // DISABLED FOR TESTING: User wants to see signals now (Sunday)

    // US Open Volatility (13:30 - 14:30 UTC => 7 PM - 8 PM IST)
    const isUSOpen = hour === 13 || hour === 14; 
    
    // Safety Check string
    let timeSafetyWarning = '';
    // if (isWeekend) timeSafetyWarning = 'WEEKEND (Low Liquidity)';
    if (isUSOpen) timeSafetyWarning = 'US OPEN (High Volatility)';

    // --- MARKET REGIME FILTER ---
    const regime = isDowntrend ? 'DOWNTREND 🔴' : 'UPTREND 🟢';
    const volatility = isHighVolatility ? 'HIGH VOLATILITY ⚠️' : 'Normal';

    // --- DAILY LIMITS CHECK ---
    const stats = await BotService.getTradingStats();
    let limitWarning = '';
    
    if (stats.tradesToday >= 3) limitWarning = 'Daily Trade Limit Reached (3/3)';
    if (stats.dailyPnL <= -300) limitWarning = 'Daily Loss Limit Hit (-$300)';
    if (stats.consecutiveLosses >= 3) limitWarning = 'Circuit Breaker: 3 Consecutive Losses';

    if (activePosition) {
        // --- MANAGE ACTIVE POSITION ---
        
        let closeReason = '';
        let pnl = 0;

        // 1. Check STOP LOSS (Critical)
        if (activePosition.stopLossPrice && currentPrice <= activePosition.stopLossPrice) {
            closeReason = 'Stop Loss';
            signal = 'SELL';
            reasons.push(`STOP LOSS HIT ($${activePosition.stopLossPrice})`);
        }
        // 2. Trailing Stop Logic
        else {
             // Update Highest Price Seen
            const highest = activePosition.highestPriceSeen || activePosition.entry_price;
            if (currentPrice > highest) {
                await BotService.updatePosition(activePosition.id, { highestPriceSeen: currentPrice });
            }
            
            // 3. Technical Exit (Indicators)
            const isRsiOverbought = currentRSI > 70;
            const isMacdBearish = macdHist < 0;

            if (isRsiOverbought && isMacdBearish) {
                signal = 'SELL';
                closeReason = 'Indicator Exit';
                reasons.push('RSI Overbought (>70)', 'MACD Bearish flip');
            } else if (currentPrice >= bbUpper) {
                reasons.push('Hit Upper Bollinger Band (Watch for exit)');
            }
        }

        // EXECUTE CLOSE
        if (signal === 'SELL') {
             const result = await BotService.closePosition(activePosition.id, currentPrice, closeReason);
             actionTaken = `EXECUTION: Closed (${closeReason})`;
             
             // Update Stats
             const tradePnL = result.pnl;
             stats.tradesToday += 0; // Closing doesn't count as a "new trade"? Or maybe it does? usually opening counts.
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

        // 1. Global Filters
        if (limitWarning) {
            actionTaken = `SKIPPING: ${limitWarning}`;
        }
        else if (isDowntrend) {
            actionTaken = 'SKIPPING: Market in Downtrend (< EMA 50)';
        } 
        else if (isHighVolatility) {
             actionTaken = 'SKIPPING: High Volatility (ATR)';
        }
        else if (timeSafetyWarning) {
            actionTaken = `SKIPPING: ${timeSafetyWarning}`;
        }
        else {
            // 2. Confluence Score System (Tier 2)
            let score = 0;
            
            const isRsiOversold = currentRSI < 30; 
            const isMacdBullish = macdHist > 0 && macdVal > macdSig;
            const isNearLowerBand = currentPrice <= bbLower * 1.01; 
            
            // Scoring Weights
            if (isRsiOversold) score += 35;
            if (isMacdBullish) score += 30;
            if (isNearLowerBand) score += 20;
            if (isHighVolume) score += 15;
            
            const SCORE_THRESHOLD = 70;

            if (score >= SCORE_THRESHOLD) {
                reasons.push(`Confluence Score: ${score}/100`);

                signal = 'BUY';
                
                // DYNAMIC POSITION SIZING (Tier 3)
                let riskUSD = 100; // Base Risk
                if (stats.consecutiveWins >= 2) riskUSD = 120; // Increase 20%
                if (stats.consecutiveLosses >= 2) riskUSD = 60; // Reduce 40%

                const quantity = Number((riskUSD / currentPrice).toFixed(5));
                
                await BotService.openPosition(SYMBOL, currentPrice, quantity);
                actionTaken = `EXECUTION: Opened Long ($${riskUSD})`;
                
                // Update Stats
                stats.tradesToday += 1;
                await BotService.updateTradingStats(stats);

            } else {
                actionTaken = `WATCHING: Score ${score}/100`;
                if (isRsiOversold) reasons.push('RSI Oversold but low confluence');
            }
        }
    }

    // 5. Notification & Response
    const USD_INR = await getUSDTInrRate();
    const priceINR = currentPrice * USD_INR;

    const shouldEmail = (signal !== 'HOLD') || (activePosition !== null && Math.abs((currentPrice - activePosition.entry_price)/activePosition.entry_price) > 0.05);

    if (shouldEmail) {
        const mailOptions = {
            from: EMAIL_USER,
            to: EMAIL_USER,
            subject: `Bot ${signal}: ${SYMBOL} @ $${currentPrice.toLocaleString()}`,
            text: `
              Action: ${actionTaken}
              Regime: ${regime} | ${volatility}
              Time Check: ${timeSafetyWarning || 'Safe'}
              Reasons: ${reasons.join(', ') || 'Holding'}
              ---------------------------
              RSI: ${currentRSI.toFixed(2)}
              MACD: ${macdHist.toFixed(4)}
              Volume: ${isHighVolume ? 'HIGH' : 'Normal'}
              ---------------------------
            `,
        };
        await transporter.sendMail(mailOptions);
    }

    // Log to DB
    await BotService.log('INFO', `Analysis: ${signal} | Regime:${regime} | Action:${actionTaken}`, { rsi: currentRSI, macd: currentMACD, bb: currentBB, regime, volatility });

    const response: BotResponse = {
      symbol: SYMBOL,
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
          macd: {
              MACD: macdVal,
              signal: macdSig,
              histogram: macdHist
          },
          bollinger: {
              upper: bbUpper,
              middle: currentBB?.middle || 0,
              lower: bbLower
          },
          volume: {
              isHigh: isHighVolume,
              average: currentVolSMA,
              current: currentVolume
          }
      }
    };

    return NextResponse.json(response);

  } catch (error: any) {
    console.error('Bot Error:', error);
    try { await BotService.log('ERROR', error.message); } catch {}
    
    return NextResponse.json(
      { error: error.message || 'An error occurred' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import ccxt from 'ccxt';
import nodemailer from 'nodemailer';
import { RSI, MACD, BollingerBands, SMA, EMA, ATR } from 'technicalindicators';
import { BotResponse } from '../../types';
import { BotService } from '../../lib/bot-service';
import { auth } from '../../lib/firebase';
import { signInAnonymously } from 'firebase/auth';

// Environment variables
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

const SYMBOL = 'BTC/USDT';
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
        const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', { next: { revalidate: 3600 } }); // Cache for 1 hour
        const data = await res.json();
        const forexRate = data.rates.INR;
        // USDT usually trades at a premium in India (approx 3-4% over Forex rate)
        return forexRate; 
    } catch (error) {
        console.warn('Failed to fetch INR rate, using fallback:', error);
        return 88.0; // Fallback
    }
}

export async function GET() {
  try {
    // Authenticate with Firebase (Anonymous)
    if (!auth.currentUser) {
        try {
            await signInAnonymously(auth);
            console.log('Bot authenticated anonymously for Firestore access.');
        } catch (authError: any) {
            console.error('Firebase Auth Error:', authError.message);
        }
    }

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
      timeout: 30000, 
      enableRateLimit: true,
    });

    // 2. Fetch Data 
    let candles;
    for (let i = 0; i < 3; i++) {
        try {
            candles = await exchange.fetchOHLCV(SYMBOL, TIMEFRAME, undefined, 200);
            break;
        } catch (e: any) {
            console.warn(`Attempt ${i+1} failed:`, e.message);
            if (i === 2) throw e;
            await new Promise(res => setTimeout(res, 2000));
        }
    }

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
    const hour = now.getHours(); 
    const utcHour = now.getUTCHours(); 
    
    // US Open Volatility
    const isUSOpen = utcHour === 13 || utcHour === 14; 
    
    // Safety Check string
    let timeSafetyWarning = '';
    if (isUSOpen) timeSafetyWarning = 'US OPEN (High Volatility)';
    
    // EOD CHECK
    const isEOD = hour >= FORCE_CLOSE_HOUR;
    if (isEOD) timeSafetyWarning = 'END OF DAY (Force Close)';

    // --- MARKET REGIME FILTER ---
    const regime = isDowntrend ? 'DOWNTREND 🔴' : 'UPTREND 🟢';
    const volatility = isHighVolatility ? 'HIGH VOLATILITY ⚠️' : 'Normal';

    // --- DAILY LIMITS CHECK ---
    const stats = await BotService.getTradingStats();
    let limitWarning = '';
    
    if (stats.tradesToday >= 5) limitWarning = 'Daily Trade Limit Reached (5/5)'; 
    if (stats.dailyPnL <= -300) limitWarning = 'Daily Loss Limit Hit (-$300)';
    if (stats.consecutiveLosses >= 3) limitWarning = 'Circuit Breaker: 3 Consecutive Losses';

    if (activePosition) {
        // --- MANAGE ACTIVE POSITION (INTRADAY LOGIC) ---
        
        let closeReason = '';
        
        // 0. Force Close at End of Day
        if (isEOD) {
             signal = 'SELL';
             closeReason = 'End of Day Exit';
             reasons.push('Force closing all positions before sleep.');
        }
        else {
             // 1. Check STOP LOSS
             if (activePosition.stopLossPrice && currentPrice <= activePosition.stopLossPrice) {
                closeReason = 'Stop Loss';
                signal = 'SELL';
                reasons.push(`STOP LOSS HIT ($${activePosition.stopLossPrice})`);
             }
             // 2. Dynamic Trailing Stop
             else {
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
                
                // 3. Technical Exit
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

        // EXECUTE CLOSE
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

        if (limitWarning) {
            actionTaken = `SKIPPING: ${limitWarning}`;
        }
        else if (isEOD) {
             actionTaken = `SKIPPING: ${timeSafetyWarning}`;
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
                
                await BotService.openPosition(SYMBOL, currentPrice, quantity);
                actionTaken = `EXECUTION: Opened Long ($${riskUSD})`;
                
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
            subject: `Bot ${signal}: ${SYMBOL} @ $${currentPrice.toLocaleString()} (₹${priceINR.toLocaleString('en-IN', {maximumFractionDigits: 0})})`,
            text: `
              Price: $${currentPrice.toLocaleString()} | ₹${priceINR.toLocaleString('en-IN', {maximumFractionDigits: 2})}
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

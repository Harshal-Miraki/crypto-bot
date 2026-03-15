import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function GET() {
  try {
    const EMAIL_USER = process.env.EMAIL_USER;
    const EMAIL_PASS = process.env.EMAIL_PASS;

    if (!EMAIL_USER || !EMAIL_PASS) {
      return NextResponse.json({ error: 'Missing email credentials' }, { status: 500 });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    });

    // ── Mock BUY signal data ───────────────────────────────────────────────────
    const symbol     = 'BTC/USDT';
    const price      = 83241.50;
    const inrRate    = 85.42;
    const priceINR   = price * inrRate;
    const atr        = 312.80;
    const sl         = +(price - 1.5 * atr).toFixed(4);
    const tp1        = +(price + 2.5 * atr).toFixed(4);
    const tp2        = +(price + 5   * atr).toFixed(4);
    const slPct      = +((price - sl)  / price * 100).toFixed(2);
    const tp1Pct     = +((tp1 - price) / price * 100).toFixed(2);
    const tp2Pct     = +((tp2 - price) / price * 100).toFixed(2);
    const capitalINR = 1000;
    const slLoss     = (slPct  / 100 * capitalINR).toFixed(1);
    const tp1Profit  = (tp1Pct / 100 * capitalINR).toFixed(1);
    const tp2Profit  = (tp2Pct / 100 * capitalINR).toFixed(1);
    const slINR      = (sl  * inrRate).toLocaleString('en-IN', { maximumFractionDigits: 0 });
    const tp1INR_str = (tp1 * inrRate).toLocaleString('en-IN', { maximumFractionDigits: 0 });
    const tp2INR_str = (tp2 * inrRate).toLocaleString('en-IN', { maximumFractionDigits: 0 });
    const score      = 72;
    const activeSetup = 'OVERSOLD BOUNCE';
    const adx        = 24;

    const body = `
══════════════════════════════════════════════
📈  BUY SIGNAL  ·  ${symbol}  ·  [${activeSetup}]
══════════════════════════════════════════════

💰  ENTRY PRICE
    USD  :  $${price.toLocaleString()}
    INR  :  ₹${priceINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}

🎯  SELL TARGETS  (Capital: ₹${capitalINR})
──────────────────────────────────────────────
    Stop Loss  :  $${sl}  ·  ₹${slINR}   (-${slPct}%  ·  -₹${slLoss})
    TP1 · 50%  :  $${tp1}  ·  ₹${tp1INR_str}  (+${tp1Pct}%  ·  +₹${tp1Profit})  ← Take half profit here
    TP2 · Full :  $${tp2}  ·  ₹${tp2INR_str}  (+${tp2Pct}%  ·  +₹${tp2Profit})  ← Final target
──────────────────────────────────────────────

📊  MARKET CONTEXT
    Trend   :  UPTREND 🟢 (1H)
    ADX     :  ${adx}  (Ranging)
    ATR     :  $${atr.toFixed(4)}

📉  INDICATORS
    StochRSI  :  K 18.3  ·  D 14.1
    RSI       :  38.2  ← Oversold
    MACD Hist :  +0.000842  ← Rising
    EMA 9/21  :  BULLISH  🚀 FRESH CROSS
    Volume    :  1.8x average  ← High

⚡  Signal Strength  :  ${score}/100
📝  Reasons  :  StochRSI Deep Oversold & Rising  |  EMA9 × EMA21 Fresh Bullish Cross  |  MACD Rising  |  Price Near Lower BB

──────────────────────────────────────────────
AlgoBot  ·  Automated Signal  ·  Not financial advice
This is a TEST email — no real trade executed
══════════════════════════════════════════════
`;

    await transporter.sendMail({
      from: EMAIL_USER,
      to: EMAIL_USER,
      subject: `🟢 [TEST] BUY ${symbol} @ $${price.toLocaleString()} · ₹${priceINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}  [${activeSetup}]`,
      text: body,
    });

    return NextResponse.json({ success: true, message: `Test BUY email sent to ${EMAIL_USER}` });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

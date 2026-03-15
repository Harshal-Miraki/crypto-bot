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

    // ── Mock BUY signal data ─────────────────────────────────────────────────
    const symbol      = 'BTC/USDT';
    const price       = 83241.50;
    const inrRate     = 85.42;
    const priceINR    = price * inrRate;
    const atr         = 312.80;
    const sl          = +(price - 1.5 * atr).toFixed(2);
    const tp1         = +(price + 2.5 * atr).toFixed(2);
    const tp2         = +(price + 5   * atr).toFixed(2);
    const slPct       = +((price - sl)  / price * 100).toFixed(2);
    const tp1Pct      = +((tp1 - price) / price * 100).toFixed(2);
    const tp2Pct      = +((tp2 - price) / price * 100).toFixed(2);
    const capitalINR  = 1000;
    const score       = 72;
    const regime      = 'UPTREND 🟢';

    const body = `
══════════════════════════════════════
🟢 BUY SIGNAL — ${symbol}
══════════════════════════════════════
Price  : $${price.toLocaleString()} | ₹${priceINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
Trend  : ${regime} (1H)
ATR    : $${atr.toFixed(2)} (14-period)

🎯 TARGETS (on ₹${capitalINR} capital):
  Stop Loss : $${sl.toLocaleString()}  (-${slPct}% | -₹${(slPct / 100 * capitalINR).toFixed(1)})
  TP1 (50%) : $${tp1.toLocaleString()} (+${tp1Pct}% | +₹${(tp1Pct / 100 * capitalINR).toFixed(1)})  ← Take half profit here
  TP2 (full): $${tp2.toLocaleString()} (+${tp2Pct}% | +₹${(tp2Pct / 100 * capitalINR).toFixed(1)})  ← Final target

📊 INDICATORS:
  StochRSI K : 18.3  |  D : 14.1   ← Deep oversold & rising ✅
  RSI        : 38.2                 ← Oversold zone ✅
  EMA 9/21   : BULLISH ✅ 🚀 FRESH CROSS!
  MACD Hist  : +0.000842 (rising)  ✅
  Volume     : 1.8x average        ✅

Signal Strength : ${score}/100
Reasons : StochRSI Deep Oversold & Rising | EMA9 × EMA21 Fresh Bullish Cross 🎯 | MACD Rising | Price Near Lower BB | High Volume (1.8x avg)

──────────────────────────────────────
⚡ AlgoBot — automated signal
This is a TEST email — no real trade executed
══════════════════════════════════════
`;

    await transporter.sendMail({
      from: EMAIL_USER,
      to: EMAIL_USER,
      subject: `🟢 [TEST] BUY ${symbol} @ ₹${priceINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
      text: body,
    });

    return NextResponse.json({ success: true, message: `Test BUY email sent to ${EMAIL_USER}` });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

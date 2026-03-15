export interface BotResponse {
  symbol: string;
  price: number;
  rsi: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
  emailSent: boolean;
  timestamp: string;
  inrRate?: number;
  activePosition?: {
    entryPrice: number;
    pnl: number;
    pnlINR?: number;
    status: string;
    stopLossPrice?: number;
    takeProfitLevel1?: number;
    targetPriceMax?: number;
  } | null;
  analysis?: {
    macd: {
        MACD: number;
        signal: number;
        histogram: number;
    };
    bollinger: {
        upper: number;
        middle: number;
        lower: number;
    };
    volume: {
        isHigh: boolean;
        average: number;
        current: number;
    };
    stochRSI?: {
        k: number;
        d: number;
    };
    ema?: {
        ema9: number;
        ema21: number;
        ema50: number;
        bullishCross: boolean;
    };
    atr?: number;
    h1Trend?: 'BULL' | 'BEAR';
  };
  confluenceScore?: number;
  scoreThreshold?: number;
  targets?: {
    stopLoss: number;
    tp1: number;
    tp2: number;
    stopPct: number;
    tp1Pct: number;
    tp2Pct: number;
    tp1INR: number;
    tp2INR: number;
  };
  forecast?: {
    prediction: string;
    timeFrame: string;
    velocity: number;
    trend: 'bullish' | 'bearish' | 'neutral';
  };
  error?: string;
}

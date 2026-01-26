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
    status: string;
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
  };
  forecast?: {
    prediction: string;
    timeFrame: string;
    velocity: number; // RSI change per candle
    trend: 'bullish' | 'bearish' | 'neutral';
  };
  error?: string;
}

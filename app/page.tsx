'use client';

import { useState, useEffect } from 'react';
import { BotResponse } from './types';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from './lib/firebase';
import Link from 'next/link';

export default function Home() {
  const [data, setData] = useState<BotResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const runBot = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/bot');
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || 'Failed to fetch');
      }

      const results = Array.isArray(json) ? json : [json];
      setData(results);

      const time = new Date().toLocaleTimeString();
      results.forEach((item: any) => {
        const inrPrice = (item.price * (item.inrRate || 88)).toLocaleString('en-IN', { maximumFractionDigits: 0 });
        const logMessage = `[${time}] ${item.symbol}: ${item.signal} (Price: ₹${inrPrice} | $${item.price.toLocaleString()})`;
        setLogs((prev) => [logMessage, ...prev]);
      });

    } catch (err: any) {
      setError(err.message);
      const logMessage = `[${new Date().toLocaleTimeString()}] Error: ${err.message}`;
      setLogs((prev) => [logMessage, ...prev]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const savedAutoRun = localStorage.getItem('bot_autoRun');
    if (savedAutoRun === 'true') {
      setIsAutoRunning(true);
      runBot();
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('bot_autoRun', String(isAutoRunning));
  }, [isAutoRunning]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isAutoRunning) {
      interval = setInterval(runBot, 600000); // 10 minutes
    }
    return () => clearInterval(interval);
  }, [isAutoRunning]);

  // Fetch History
  useEffect(() => {
    async function fetchHistory() {
      try {
        const q = query(collection(db, 'bot_logs'), orderBy('timestamp', 'desc'), limit(20));
        const snapshot = await getDocs(q);
        const history = snapshot.docs.map(doc => {
          const data = doc.data();
          return `[${new Date(data.timestamp).toLocaleTimeString()}] ${data.level}: ${data.message}`;
        });
        setLogs(prev => history); // Initial Load
      } catch (e) {
        console.error("Failed to fetch log history", e);
      }
    }
    fetchHistory();
  }, []);

  const testEmail = async () => {
    try {
      const res = await fetch('/api/test-email');
      const json = await res.json();
      if (json.success) {
        alert('Test email sent! Check your inbox.');
      } else {
        alert('Error: ' + json.error);
      }
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  }

  return (
    <div className="min-h-screen bg-transparent text-white p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="flex flex-col md:flex-row justify-between items-center border-b border-brand-blue pb-4 gap-4">
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-linear-to-r from-blue-400 to-purple-400">Crypto Multi-Bot Dashboard</h1>
          <div className="flex flex-wrap gap-3 justify-center md:justify-end">
            <Link
              href="/tracker"
              className="text-gray-300 hover:text-white px-3 py-2 rounded text-sm transition-colors border border-brand-blue hover:border-gray-500 bg-brand-navy/50 whitespace-nowrap"
            >
              🎯 Manual Tracker
            </Link>
            <Link
              href="/history"
              className="text-gray-300 hover:text-white px-3 py-2 rounded text-sm transition-colors border border-brand-blue hover:border-gray-500 bg-brand-navy/50 whitespace-nowrap"
            >
              📜 Trade History
            </Link>
            <button
              onClick={testEmail}
              className="bg-brand-navy hover:bg-brand-blue border border-brand-blue px-3 py-2 rounded text-sm transition-colors whitespace-nowrap"
            >
              Test Email
            </button>
            <button
              onClick={runBot}
              disabled={loading}
              className="bg-brand-blue hover:bg-brand-navy border border-blue-500 px-3 py-2 rounded text-sm transition-colors font-bold shadow-[0_0_15px_rgba(59,130,246,0.5)] whitespace-nowrap"
            >
              {loading ? 'Analyzing...' : '↻ Run Analysis'}
            </button>
          </div>
        </header>

        {/* Control Panel */}
        <div className="bg-[#110C18] backdrop-blur-xl p-6 rounded-xl shadow-2xl border border-[#1e1628] flex flex-col items-center text-center">
          <h3 className="text-lg font-medium text-gray-300 mb-2">Automation Control</h3>
          <p className="text-xs text-gray-400 max-w-md mb-4">
            Auto-run will verify BTC, ETH, and SOL every 10 minutes.
            <strong className="text-yellow-400 block mt-1">Keep tab open for browser-based automation.</strong>
          </p>
          <button
            onClick={() => setIsAutoRunning(!isAutoRunning)}
            className={`w-full max-w-md py-3 rounded-lg font-bold text-lg transition-all shadow-lg ${isAutoRunning
              ? 'bg-brand-red hover:bg-red-900 border border-red-500 animate-pulse'
              : 'bg-brand-green hover:bg-green-900 border border-green-500'
              }`}
          >
            {isAutoRunning ? 'STOP BOTS (Running)' : 'START AUTO-RUN'}
          </button>
        </div>

        {/* Strategy Reference Guide */}
        <div className="bg-brand-navy/60 backdrop-blur-xl p-6 rounded-xl shadow-2xl border border-[#1e1628]">
          <h3 className="text-lg font-bold text-gray-200 mb-4 border-b border-brand-blue/30 pb-2">📊 Strategy Reference Guide (Intraday)</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-sm">
            <div className="space-y-1">
              <p className="text-gray-400 text-xs uppercase tracking-widest">RSI (Momentum)</p>
              <p className="text-white font-mono"><span className="text-green-400">Buy &lt; 30</span> (Oversold)</p>
              <p className="text-white font-mono"><span className="text-red-400">Sell &gt; 75</span> (Overbought)</p>
            </div>
            <div className="space-y-1">
              <p className="text-gray-400 text-xs uppercase tracking-widest">MACD (Trend)</p>
              <p className="text-white font-mono"><span className="text-green-400">Green Hist</span> = Bullish</p>
              <p className="text-white font-mono"><span className="text-red-400">Red Flip</span> = Exit Signal</p>
            </div>
            <div className="space-y-1">
              <p className="text-gray-400 text-xs uppercase tracking-widest">Risk Management</p>
              <p className="text-white font-mono">Stop Loss: <span className="text-red-400">Fixed 3.0%</span></p>
              <p className="text-white font-mono">Trailing Stop: <span className="text-blue-400">1.5% Gap</span></p>
            </div>
            <div className="space-y-1">
              <p className="text-gray-400 text-xs uppercase tracking-widest">Profit Booking</p>
              <p className="text-yellow-400 font-bold">Bot Auto-Books When:</p>
              <ul className="text-gray-300 text-xs list-disc pl-4 space-y-1">
                <li>RSI hits extreme (&gt;75)</li>
                <li>Price drops 1.5% from Peak</li>
                <li>End of Day (11:00 PM)</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Crypto Grid */}
        {data.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {data.map((coin) => (
              <div key={coin.symbol} className="bg-brand-navy/40 backdrop-blur-md p-6 rounded-xl shadow-xl border border-brand-blue flex flex-col hover:bg-brand-navy/60 transition-all">
                <div className="flex justify-between items-center mb-4 border-b border-brand-blue pb-2">
                  <h2 className="text-2xl font-bold text-white tracking-wider">{coin.symbol?.split('/')[0]}</h2>
                  <span className={`px-2 py-1 rounded text-xs font-bold ${coin.signal === 'BUY' ? 'bg-brand-green text-green-300 border border-green-500' :
                    coin.signal === 'SELL' ? 'bg-brand-red text-red-300 border border-red-500' :
                      'bg-brand-plum text-gray-400 border border-gray-700'
                    }`}>
                    {coin.signal}
                  </span>
                </div>

                {coin.error ? (
                  <div className="text-red-400 text-sm py-4">Error: {coin.error}</div>
                ) : (
                  <div className="flex-1 space-y-4">
                    <div className="bg-brand-black/30 p-3 rounded-lg border border-brand-blue/30">
                      <div className="flex justify-between items-baseline">
                        <span className="text-gray-400 text-xs">INR</span>
                        <span className="text-2xl font-mono font-bold text-white">₹{(coin.price * (coin.inrRate || 88)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                      </div>
                      <div className="flex justify-between items-baseline text-gray-300">
                        <span className="text-gray-500 text-xs">USDT</span>
                        <span className="text-sm font-mono">${coin.price?.toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-brand-black/30 p-2 rounded border border-brand-blue/20">
                        <span className="block text-gray-500">RSI</span>
                        <span className={`font-mono font-bold ${coin.rsi > 70 ? 'text-red-400' : coin.rsi < 30 ? 'text-green-400' : 'text-gray-300'}`}>
                          {coin.rsi?.toFixed(2)}
                        </span>
                      </div>
                      <div className="bg-brand-black/30 p-2 rounded text-right border border-brand-blue/20">
                        <span className="block text-gray-500">MACD</span>
                        <span className={`font-mono ${(coin.analysis?.macd?.histogram || 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {coin.analysis?.macd?.histogram.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* Forecast Engine UI */}
                    {coin.forecast && coin.forecast.prediction !== 'Market Stagnant' && (
                      <div className={`mt-3 p-2 rounded-lg border relative overflow-hidden ${coin.forecast.trend === 'bullish' ? 'bg-purple-900/20 border-purple-500/30' :
                        coin.forecast.trend === 'bearish' ? 'bg-blue-900/20 border-blue-500/30' :
                          'bg-gray-800/30 border-gray-700'
                        }`}>
                        <div className="absolute top-0 right-0 w-16 h-16 bg-linear-to-br from-white/5 to-transparent rounded-full -mr-8 -mt-8 pointer-events-none"></div>
                        <div className="flex justify-between items-center text-xs mb-1">
                          <span className="text-gray-400 flex items-center gap-1">🔮 AI Forecast</span>
                          <span className={`font-mono text-[10px] ${coin.forecast.velocity > 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {coin.forecast.velocity > 0 ? 'Rising' : 'Falling'} ({coin.forecast.velocity})
                          </span>
                        </div>
                        <div className="flex justify-between items-end">
                          <span className="text-sm font-bold text-gray-200">{coin.forecast.prediction}</span>
                          <span className="text-xs text-yellow-400 font-mono bg-yellow-400/10 px-1 rounded border border-yellow-400/20">
                            {coin.forecast.timeFrame}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Active Position Status */}
                    <div className="mt-auto pt-2">
                      {coin.activePosition ? (
                        <div className="w-full bg-brand-green/20 border border-brand-green p-2 rounded text-center">
                          <div className="text-green-400 font-bold text-sm">OPEN LONG</div>
                          <div className="text-xs text-gray-400 font-mono mt-1">
                            Entry: ${coin.activePosition.entryPrice.toLocaleString()}
                            <br />
                            PnL: {coin.activePosition.pnl > 0 ? '+' : ''}{coin.activePosition.pnl.toFixed(2)}
                          </div>
                        </div>
                      ) : (
                        <div className="w-full bg-brand-plum/30 border border-brand-blue/30 p-2 rounded text-center text-xs text-gray-500">
                          No Active Position
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-20 bg-brand-navy/30 rounded-xl border-dashed border-2 border-brand-blue">
            <p className="text-gray-400 mb-4">Dashboard Ready</p>
            <button
              onClick={runBot}
              disabled={loading}
              className="bg-brand-blue hover:bg-brand-navy px-6 py-3 rounded-lg font-bold transition-colors shadow-lg border border-blue-500"
            >
              {loading ? 'Initializing Bots...' : 'Start All Bots'}
            </button>
          </div>
        )}

        {/* Logs */}
        <div className="bg-brand-black/90 p-4 rounded-xl shadow-inner font-mono text-sm h-64 overflow-y-auto border border-brand-blue/50">
          <h3 className="text-gray-500 mb-2 sticky top-0 bg-brand-black/90 pb-2 border-b border-brand-blue/30">Activity Log</h3>
          {logs.length === 0 && <span className="text-gray-600">Waiting for activity...</span>}
          {logs.map((log, i) => (
            <div key={i} className="mb-1 text-gray-300 border-b border-brand-blue/20 pb-1">
              {log}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

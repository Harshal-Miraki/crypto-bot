'use client';

import { useState, useEffect } from 'react';
import { BotResponse } from './types';

export default function Home() {
  const [data, setData] = useState<BotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Constants
  const USD_INR = 88; // sync with backend approx

  const runBot = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/bot');
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || 'Failed to fetch');
      }

      setData(json);
      const logMessage = `[${new Date().toLocaleTimeString()}] ${json.symbol}: ${json.signal} (RSI: ${json.rsi.toFixed(2)})`;
      setLogs((prev) => [logMessage, ...prev]);
    } catch (err: any) {
      setError(err.message);
      const logMessage = `[${new Date().toLocaleTimeString()}] Error: ${err.message}`;
      setLogs((prev) => [logMessage, ...prev]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isAutoRunning) {
      runBot(); // Run immediately on start
      interval = setInterval(runBot, 600000); // Run every 10 minutes (600,000 ms)
    }
    return () => clearInterval(interval);
  }, [isAutoRunning]);

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
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex justify-between items-center border-b border-gray-700 pb-4">
          <h1 className="text-3xl font-bold text-blue-400">Crypto Trading Bot</h1>
          <div className="space-x-4">
            <button
              onClick={testEmail}
              className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm transition-colors"
            >
              Test Email
            </button>
          </div>
        </header>

        {/* Status Card */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-gray-300">Market Status</h2>
            {data ? (
              <div className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-gray-400">Symbol:</span>
                  <span className="font-mono text-lg">{data.symbol}</span>
                </div>

                <div className="p-4 bg-gray-700 rounded-lg">
                  <div className="flex justify-between items-end mb-1">
                    <span className="text-gray-400 text-sm">Price (INR)</span>
                    <span className="font-mono text-2xl font-bold text-white">₹{(data.price * (data.inrRate || 88)).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-xs">Price (USDT)</span>
                    <span className="font-mono text-sm text-gray-300">${data.price.toLocaleString()}</span>
                  </div>
                </div>

                <div className="flex justify-between">
                  <span className="text-gray-400">RSI (14):</span>
                  <span className={`font-mono text-lg ${data.rsi > 70 ? 'text-red-400' : data.rsi < 30 ? 'text-green-400' : 'text-yellow-400'
                    }`}>{data.rsi.toFixed(2)}</span>
                </div>

                {data.analysis && (
                  <div className="grid grid-cols-2 gap-2 text-sm mt-2 pt-2 border-t border-gray-700">
                    <div>
                      <span className="text-gray-500 block text-xs">MACD</span>
                      <span className={`font-mono ${data.analysis.macd.histogram > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {data.analysis.macd.histogram.toFixed(4)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-gray-500 block text-xs">Volume</span>
                      <span className={`font-mono ${data.analysis.volume.isHigh ? 'text-blue-400 font-bold' : 'text-gray-400'}`}>
                        {data.analysis.volume.isHigh ? 'HIGH' : 'Normal'}
                      </span>
                    </div>
                    <div className="col-span-2 mt-1">
                      <span className="text-gray-500 block text-xs">Bollinger Range via Price</span>
                      <div className="w-full h-2 bg-gray-600 rounded-full mt-1 relative overflow-hidden">
                        {/* Simple viz of price within bands */}
                        <div
                          className="absolute top-0 bottom-0 w-1 bg-white"
                          style={{
                            left: `${Math.max(0, Math.min(100, ((data.price - data.analysis.bollinger.lower) / (data.analysis.bollinger.upper - data.analysis.bollinger.lower)) * 100))}%`
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                        <span>Lower: {data.analysis.bollinger.lower.toFixed(0)}</span>
                        <span>Upper: {data.analysis.bollinger.upper.toFixed(0)}</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-4 pt-4 border-t border-gray-700">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Action:</span>
                    <span className={`px-3 py-1 rounded text-sm font-bold ${data.signal === 'BUY' ? 'bg-green-900 text-green-300' :
                      data.signal === 'SELL' ? 'bg-red-900 text-red-300' :
                        'bg-gray-600 text-gray-300'
                      }`}>
                      {data.signal}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-500 py-8">
                No data yet. Run the bot.
              </div>
            )}
          </div>

          <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700 flex flex-col justify-center items-center space-y-6">

            {/* Active Position Info */}
            <div className="w-full bg-gray-900/50 p-4 rounded-lg border border-gray-600">
              <h3 className="text-sm font-semibold text-gray-400 mb-2 uppercase tracking-wider">Trading State</h3>
              {data?.activePosition ? (
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-green-400 font-bold">
                    <span>🟢 LONG (OPEN)</span>
                    <span>PnL: {data.activePosition.pnl > 0 ? '+' : ''}{data.activePosition.pnl.toFixed(2)}</span>
                  </div>
                  <div className="text-sm text-gray-300">
                    Entry: ${data.activePosition.entryPrice.toLocaleString()}
                  </div>
                </div>
              ) : (
                <div className="text-gray-500 font-mono text-center py-2">
                  ⚪ NO ACTIVE POSITION
                  <div className="text-xs mt-1">Waiting for RSI &lt; 30</div>
                </div>
              )}
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-lg font-medium text-gray-300">Automation Control</h3>
              <p className="text-xs text-gray-500 max-w-xs">
                Auto-run will check & email every 10 minutes.
                <br /><strong className="text-yellow-500">Keep this tab open!</strong>
              </p>
            </div>
            <button
              onClick={() => setIsAutoRunning(!isAutoRunning)}
              className={`w-full py-4 rounded-lg font-bold text-lg transition-colors shadow-lg ${isAutoRunning
                ? 'bg-red-600 hover:bg-red-700 animate-pulse'
                : 'bg-green-600 hover:bg-green-700'
                }`}
            >
              {isAutoRunning ? 'STOP BOT (Running 24/7)' : 'START AUTO-RUN (10 Min)'}
            </button>

            <button
              onClick={runBot}
              disabled={loading || isAutoRunning}
              className="w-full bg-blue-600 hover:bg-blue-700 py-3 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Analyzing...' : 'Run Analysis Once'}
            </button>
          </div>
        </div>

        {/* Logs */}
        <div className="bg-black p-4 rounded-xl shadow-inner font-mono text-sm h-64 overflow-y-auto border border-gray-800">
          <h3 className="text-gray-500 mb-2 sticky top-0 bg-black pb-2 border-b border-gray-800">Activity Log</h3>
          {logs.length === 0 && <span className="text-gray-600">Waiting for activity...</span>}
          {logs.map((log, i) => (
            <div key={i} className="mb-1 text-gray-300 border-b border-gray-900 pb-1">
              {log}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

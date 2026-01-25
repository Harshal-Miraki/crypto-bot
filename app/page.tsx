'use client';

import { useState, useEffect } from 'react';
import { BotResponse } from './types';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from './lib/firebase';

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



  // ... inside component ...
  // Load auto-run state from localStorage on mount
  useEffect(() => {
    const savedAutoRun = localStorage.getItem('bot_autoRun');
    if (savedAutoRun === 'true') {
      setIsAutoRunning(true);
    }
    // Also run a fresh analysis on load if we want immediate data
    // Or just let the auto-runner handle it?
    // User wants "latest info" on reload. 
    // Let's trigger a runBot() if auto-run is ON, or just fetch status.
    // Since runBot triggers analysis, let's call it safely.
    if (savedAutoRun === 'true') {
      runBot();
    }
  }, []);

  // Save auto-run state
  useEffect(() => {
    localStorage.setItem('bot_autoRun', String(isAutoRunning));
  }, [isAutoRunning]);

  // Auto-Run Loop
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isAutoRunning) {
      // If we just mounted and set isAutoRunning=true, runBot might run twice if we are not careful?
      // actually runBot() above is in the mount effect.
      // This effect runs when isAutoRunning changes.
      // Let's rely on this effect to start the interval.
      // But we also want an *immediate* run if we just toggled it ON or loaded page.

      // If we rely purely on interval, first run is delayed by 10 mins.
      // We want immediate execution.
      // But avoid double execution on mount.
      // Simpler logic:
      // The mount effect sets state. This effect sees "true".
      // We can check if data is null? 

      interval = setInterval(runBot, 600000); // 10 minutes
    }
    return () => clearInterval(interval);
  }, [isAutoRunning]);

  // Fetch History (Persistent Logs)
  useEffect(() => {
    async function fetchHistory() {
      try {
        const q = query(collection(db, 'bot_logs'), orderBy('timestamp', 'desc'), limit(20));
        const snapshot = await getDocs(q);
        const history = snapshot.docs.map(doc => {
          const data = doc.data();
          return `[${new Date(data.timestamp).toLocaleTimeString()}] ${data.level}: ${data.message}`;
        });
        setLogs(prev => {
          // Avoid duplicates if merging
          return history;
        });
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
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-300">Market Status</h2>
              <button
                onClick={runBot}
                disabled={loading}
                className="text-gray-400 hover:text-white transition-colors bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-xs"
                title="Refresh Data"
              >
                {loading ? '...' : '↻ Refresh'}
              </button>
            </div>
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

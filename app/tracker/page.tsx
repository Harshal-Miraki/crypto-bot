'use client';

import { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query } from 'firebase/firestore';
import { Navbar } from '../components/Navbar';
import { BotResponse } from '../types';

type ManualTrade = {
  id: string;
  symbol: string;
  entryPrice: number;
  targetPrice: number;
  addedAt: string;
};

const COIN_META: Record<string, { symbol: string; color: string; bg: string }> = {
  'BTC/USDT':  { symbol: '₿', color: '#f7931a', bg: 'rgba(247,147,26,0.08)' },
  'ETH/USDT':  { symbol: 'Ξ', color: '#627eea', bg: 'rgba(98,126,234,0.08)' },
  'SOL/USDT':  { symbol: '◎', color: '#9945ff', bg: 'rgba(153,69,255,0.08)' },
  'BNB/USDT':  { symbol: '◈', color: '#f3ba2f', bg: 'rgba(243,186,47,0.08)' },
  'XRP/USDT':  { symbol: '✕', color: '#00aae4', bg: 'rgba(0,170,228,0.08)' },
  'ADA/USDT':  { symbol: '₳', color: '#0033ad', bg: 'rgba(0,51,173,0.08)' },
  'AVAX/USDT': { symbol: 'Δ', color: '#e84142', bg: 'rgba(232,65,66,0.08)' },
  'DOGE/USDT': { symbol: 'Ð', color: '#c2a633', bg: 'rgba(194,166,51,0.08)' },
};

const ALL_SYMBOLS = Object.keys(COIN_META);

export default function TrackerPage() {
  const [trades, setTrades]         = useState<ManualTrade[]>([]);
  const [coin, setCoin]             = useState('BTC/USDT');
  const [entryPrice, setEntryPrice] = useState('');
  const [adding, setAdding]         = useState(false);
  const [marketData, setMarketData] = useState<Record<string, { price: number; inrRate: number }>>({});
  const [fetchingPrices, setFetchingPrices] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchTrades = async () => {
    const snap = await getDocs(query(collection(db, 'manual_trades')));
    setTrades(snap.docs.map(d => ({ id: d.id, ...d.data() } as ManualTrade)));
  };

  const fetchPrices = async () => {
    setFetchingPrices(true);
    try {
      const res  = await fetch('/api/bot');
      const data: BotResponse[] = await res.json();
      if (Array.isArray(data)) {
        const map: Record<string, { price: number; inrRate: number }> = {};
        data.forEach(d => { map[d.symbol] = { price: d.price, inrRate: d.inrRate ?? 88 }; });
        setMarketData(map);
      }
    } catch { /* non-critical */ } finally { setFetchingPrices(false); }
  };

  useEffect(() => {
    fetchTrades();
    fetchPrices();
    const iv = setInterval(fetchPrices, 30_000);
    return () => clearInterval(iv);
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entryPrice) return;
    setAdding(true);
    try {
      await addDoc(collection(db, 'manual_trades'), {
        symbol:      coin,
        entryPrice:  parseFloat(entryPrice),
        targetPrice: parseFloat(entryPrice) * 1.03,
        addedAt:     new Date().toISOString(),
      });
      setEntryPrice('');
      await fetchTrades();
    } catch { /* non-critical */ } finally { setAdding(false); }
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'manual_trades', id));
    setConfirmDelete(null);
    await fetchTrades();
  };

  const selectedMeta = COIN_META[coin] ?? { symbol: '?', color: '#94a3b8', bg: 'rgba(148,163,184,0.08)' };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>

      <Navbar active="tracker" actions={
        <button onClick={fetchPrices} disabled={fetchingPrices} className="btn-ghost text-xs">
          {fetchingPrices ? (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 border border-white/20 border-t-white/60 rounded-full spin-slow" />
              Updating
            </span>
          ) : '↻ Prices'}
        </button>
      } />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold gradient-text">Manual Tracker</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Track your own trades alongside bot signals — prices update every 30s
          </p>
        </div>

        {/* Add Trade Form */}
        <div className="glass rounded-2xl p-6" style={{ border: '1px solid var(--border-blue)' }}>
          <div className="flex items-center gap-2 mb-5">
            <span className="w-1 h-4 rounded-full" style={{ background: 'var(--blue)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Track a New Trade</h2>
          </div>

          <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            {/* Coin selector */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Select Pair
              </label>
              <div className="relative">
                <select
                  value={coin} onChange={e => setCoin(e.target.value)}
                  className="input-dark w-full appearance-none cursor-pointer"
                  style={{ paddingLeft: '2.5rem' }}
                >
                  {ALL_SYMBOLS.map(s => (
                    <option key={s} value={s} style={{ background: '#0c0c1d' }}>{s}</option>
                  ))}
                </select>
                <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-sm font-bold"
                  style={{ color: selectedMeta.color }}>
                  {selectedMeta.symbol}
                </div>
              </div>
            </div>

            {/* Entry price */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Your Entry Price (USD)
              </label>
              <input
                type="number" step="any" min="0"
                value={entryPrice} onChange={e => setEntryPrice(e.target.value)}
                placeholder="e.g. 83200.50"
                required
                className="input-dark w-full font-mono"
              />
              {entryPrice && marketData[coin] && (
                <p className="text-xs mt-1 font-mono" style={{ color: 'var(--text-muted)' }}>
                  ≈ ₹{(parseFloat(entryPrice) * (marketData[coin]?.inrRate ?? 88)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </p>
              )}
            </div>

            {/* Submit */}
            <button type="submit" disabled={adding || !entryPrice} className="btn-primary h-10">
              {adding ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border border-white/30 border-t-white rounded-full spin-slow" />
                  Adding…
                </span>
              ) : '+ Start Tracking'}
            </button>
          </form>

          {/* Current market prices hint */}
          {Object.keys(marketData).length > 0 && (
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Live prices for reference:</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(marketData).map(([sym, d]) => (
                  <span key={sym} className="text-xs font-mono px-2 py-1 rounded-lg"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    <span style={{ color: COIN_META[sym]?.color }}>{sym.split('/')[0]}</span>
                    {' '}${d.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Trade Cards */}
        {trades.length === 0 ? (
          <div className="glass rounded-2xl py-20 text-center" style={{ border: '1px dashed var(--border-muted)' }}>
            <div className="text-3xl mb-3">🎯</div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No trades tracked yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Add a trade above to start monitoring it</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {trades.map(trade => {
              const meta         = COIN_META[trade.symbol] ?? { symbol: '?', color: '#94a3b8', bg: 'rgba(148,163,184,0.08)' };
              const mkt          = marketData[trade.symbol];
              const currentPrice = mkt?.price ?? trade.entryPrice;
              const inrRate      = mkt?.inrRate ?? 88;

              const pnlPct   = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
              const pnlINR   = (pnlPct / 100) * 1000; // on ₹1000 capital
              const isProfit = pnlPct >= 0;
              const atTarget = currentPrice >= trade.targetPrice;

              const entryINR   = trade.entryPrice * inrRate;
              const currentINR = currentPrice * inrRate;
              const targetINR  = trade.targetPrice * inrRate;

              return (
                <div key={trade.id} className="glass rounded-2xl p-5 space-y-4 fade-in transition-all"
                  style={{ border: `1px solid ${atTarget ? 'rgba(16,185,129,0.35)' : isProfit ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)'}` }}>

                  {/* Card Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold shrink-0"
                        style={{ background: meta.bg, color: meta.color }}>
                        {meta.symbol}
                      </div>
                      <div>
                        <div className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                          {trade.symbol}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {new Date(trade.addedAt).toLocaleDateString()} {new Date(trade.addedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>

                    {atTarget ? (
                      <span className="text-xs px-2 py-1 rounded-full font-semibold"
                        style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.3)' }}>
                        🎯 Target Hit
                      </span>
                    ) : null}
                  </div>

                  {/* Price grid */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Entry', price: entryINR, usd: trade.entryPrice, color: 'var(--text-secondary)' },
                      { label: 'Current', price: currentINR, usd: currentPrice, color: isProfit ? '#34d399' : '#fb7185' },
                      { label: 'Target (+3%)', price: targetINR, usd: trade.targetPrice, color: '#fbbf24' },
                    ].map(({ label, price, usd, color }) => (
                      <div key={label} className="rounded-xl p-2.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)' }}>
                        <div className="text-xs mb-1" style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.6rem' }}>{label}</div>
                        <div className="font-mono font-semibold text-sm" style={{ color }}>
                          ₹{price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </div>
                        <div className="font-mono text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          ${usd.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* P&L */}
                  <div className="rounded-xl p-3" style={{
                    background: isProfit ? 'rgba(16,185,129,0.07)' : 'rgba(244,63,94,0.07)',
                    border: `1px solid ${isProfit ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)'}`
                  }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Unrealised P&L (₹1000)</span>
                      <div className="text-right">
                        <div className="font-mono font-bold text-lg" style={{ color: isProfit ? '#34d399' : '#fb7185' }}>
                          {isProfit ? '+' : ''}{pnlPct.toFixed(2)}%
                        </div>
                        <div className="font-mono text-xs" style={{ color: isProfit ? '#10b981' : '#f43f5e' }}>
                          {isProfit ? '+' : ''}₹{pnlINR.toFixed(1)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Progress bar to target */}
                  <div>
                    <div className="flex justify-between text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
                      <span>Progress to target</span>
                      <span>{Math.min(100, Math.max(0, (pnlPct / 3) * 100)).toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-1.5 rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.min(100, Math.max(0, (pnlPct / 3) * 100))}%`,
                          background: atTarget ? '#10b981' : isProfit ? 'linear-gradient(90deg,#3b82f6,#10b981)' : '#f43f5e'
                        }} />
                    </div>
                  </div>

                  {/* Delete */}
                  {confirmDelete === trade.id ? (
                    <div className="flex gap-2">
                      <button onClick={() => handleDelete(trade.id)}
                        className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                        style={{ background: 'rgba(244,63,94,0.15)', color: '#fb7185', border: '1px solid rgba(244,63,94,0.3)' }}>
                        Confirm Stop
                      </button>
                      <button onClick={() => setConfirmDelete(null)}
                        className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                        style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(trade.id)} className="btn-danger w-full py-2 text-xs">
                      Stop Tracking
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

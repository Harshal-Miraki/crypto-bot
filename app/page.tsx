'use client';

import { useState, useEffect, useCallback } from 'react';
import { BotResponse } from './types';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from './lib/firebase';
import { Navbar } from './components/Navbar';

// ─── Coin colours ─────────────────────────────────────────────────────────────
const COIN_META: Record<string, { icon: string; color: string; bg: string }> = {
  'BTC/USDT':  { icon: '₿', color: '#f7931a', bg: 'rgba(247,147,26,0.1)'  },
  'ETH/USDT':  { icon: 'Ξ', color: '#627eea', bg: 'rgba(98,126,234,0.1)'  },
  'SOL/USDT':  { icon: '◎', color: '#9945ff', bg: 'rgba(153,69,255,0.1)'  },
  'BNB/USDT':  { icon: '◈', color: '#f3ba2f', bg: 'rgba(243,186,47,0.1)'  },
  'XRP/USDT':  { icon: '✕', color: '#00aae4', bg: 'rgba(0,170,228,0.1)'   },
  'ADA/USDT':  { icon: '₳', color: '#5585ff', bg: 'rgba(85,133,255,0.1)'  },
  'AVAX/USDT': { icon: 'Δ', color: '#e84142', bg: 'rgba(232,65,66,0.1)'   },
  'DOGE/USDT': { icon: 'Ð', color: '#c2a633', bg: 'rgba(194,166,51,0.1)'  },
};

// ─── Signal badge ─────────────────────────────────────────────────────────────
function SignalBadge({ signal }: { signal: string }) {
  const styles: Record<string, { bg: string; color: string; border: string; dot: string }> = {
    BUY:  { bg: 'rgba(16,185,129,0.12)', color: '#34d399', border: 'rgba(16,185,129,0.35)', dot: '#10b981' },
    SELL: { bg: 'rgba(244,63,94,0.12)',  color: '#fb7185', border: 'rgba(244,63,94,0.35)',  dot: '#f43f5e' },
    HOLD: { bg: 'rgba(100,116,139,0.1)', color: '#94a3b8', border: 'rgba(100,116,139,0.2)', dot: '#475569' },
  };
  const s = styles[signal] ?? styles.HOLD;
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '4px 10px', borderRadius: '9999px', fontSize: '0.7rem',
        fontWeight: 700, letterSpacing: '0.06em',
        background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      }}
    >
      <span
        style={{ width: 7, height: 7, borderRadius: '50%', background: s.dot, flexShrink: 0 }}
        className={signal !== 'HOLD' ? 'blink' : ''}
      />
      {signal}
    </span>
  );
}

// ─── Mini bar indicator ───────────────────────────────────────────────────────
function MiniBar({
  label, value, min = 0, max = 100, color,
}: { label: string; value: number; min?: number; max?: number; color: string }) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
        <span style={{ color, fontSize: '0.7rem', fontFamily: 'var(--font-geist-mono)', fontWeight: 600 }}>{value.toFixed(1)}</span>
      </div>
      <div style={{ height: 3, borderRadius: 99, background: 'rgba(255,255,255,0.06)' }}>
        <div style={{ height: 3, width: `${pct}%`, borderRadius: 99, background: color, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  );
}

// ─── Coin Card ────────────────────────────────────────────────────────────────
function CoinCard({ coin }: { coin: BotResponse }) {
  const meta      = COIN_META[coin.symbol] ?? { icon: '?', color: '#94a3b8', bg: 'rgba(148,163,184,0.08)' };
  const inrRate   = coin.inrRate ?? 88;
  const priceINR  = coin.price * inrRate;

  const rsi       = coin.rsi ?? 50;
  const stochK    = coin.analysis?.stochRSI?.k ?? 50;
  const macdHist  = coin.analysis?.macd?.histogram ?? 0;
  const h1Trend   = coin.analysis?.h1Trend ?? 'BULL';
  const emaCross  = coin.analysis?.ema?.bullishCross ?? false;
  const ema9Above = (coin.analysis?.ema?.ema9 ?? 0) > (coin.analysis?.ema?.ema21 ?? 0);
  const volHigh   = coin.analysis?.volume?.isHigh ?? false;
  const atr       = coin.analysis?.atr ?? 0;
  const score     = coin.confluenceScore ?? 0;
  const threshold = coin.scoreThreshold ?? 55;

  const pos       = coin.activePosition;
  const hasTrade = !!pos;
  const pnlINR   = pos?.pnlINR ?? 0;
  const isPnlPos = (pos?.pnl ?? 0) >= 0;

  const targets   = coin.targets;

  // ── card border/glow colour by signal ──
  const borderColors: Record<string, string> = {
    BUY:  'rgba(16,185,129,0.4)',
    SELL: 'rgba(244,63,94,0.4)',
    HOLD: hasTrade ? 'rgba(59,130,246,0.25)' : 'var(--border-subtle)',
  };
  const glowColors: Record<string, string> = {
    BUY:  '0 0 28px rgba(16,185,129,0.12)',
    SELL: '0 0 28px rgba(244,63,94,0.12)',
    HOLD: 'none',
  };

  // RSI colour
  const rsiColor = rsi > 70 ? '#f43f5e' : rsi < 30 ? '#10b981' : '#94a3b8';
  // StochRSI colour
  const stochColor = stochK > 80 ? '#f43f5e' : stochK < 20 ? '#10b981' : '#94a3b8';

  return (
    <div
      className="fade-in"
      style={{
        background: 'var(--bg-card)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${borderColors[coin.signal] ?? 'var(--border-subtle)'}`,
        boxShadow: glowColors[coin.signal] ?? 'none',
        borderRadius: 18,
        padding: '18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        transition: 'border-color 0.3s, box-shadow 0.3s',
      }}
    >
      {/* ── Row 1: Symbol + Signal ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 40, height: 40, borderRadius: 12, background: meta.bg,
              color: meta.color, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: '1.1rem', fontWeight: 700, flexShrink: 0,
            }}
          >
            {meta.icon}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              {coin.symbol.split('/')[0]}
              <span style={{ fontWeight: 400, fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 4 }}>/ USDT</span>
            </div>
            <div style={{ fontSize: '0.65rem', marginTop: 1 }}>
              {h1Trend === 'BULL'
                ? <span style={{ color: '#34d399' }}>▲ 1H Uptrend</span>
                : <span style={{ color: '#fb7185' }}>▼ 1H Downtrend</span>}
              {emaCross && <span style={{ color: '#fbbf24', marginLeft: 6 }}>✦ EMA Cross</span>}
            </div>
          </div>
        </div>
        <SignalBadge signal={coin.signal} />
      </div>

      {/* ── Error state ── */}
      {coin.error ? (
        <div style={{ fontSize: '0.75rem', padding: '10px 12px', borderRadius: 10, color: '#fb7185', background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)' }}>
          ⚠ {coin.error}
        </div>
      ) : (
        <>
          {/* ── Row 2: Price ── */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'var(--font-geist-mono)', letterSpacing: '-0.02em', color: 'var(--text-primary)', lineHeight: 1.1 }}>
              ₹{priceINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-geist-mono)', color: 'var(--text-muted)' }}>
                ${coin.price?.toLocaleString(undefined, { maximumFractionDigits: 6 })}
              </span>
              {atr > 0 && (
                <span style={{ fontSize: '0.65rem', fontFamily: 'var(--font-geist-mono)', color: 'var(--text-muted)' }}>
                  ATR {atr.toFixed(4)}
                </span>
              )}
            </div>
          </div>

          {/* ── Row 3: Indicators ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <MiniBar label="RSI (14)" value={rsi} color={rsiColor} />
            <MiniBar label="StochRSI K" value={stochK} color={stochColor} />
          </div>

          {/* ── Row 4: Status pills ── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {/* MACD */}
            <span style={{
              fontSize: '0.68rem', fontWeight: 600, padding: '3px 8px', borderRadius: 6,
              background: macdHist > 0 ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)',
              color: macdHist > 0 ? '#34d399' : '#fb7185',
              border: `1px solid ${macdHist > 0 ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)'}`,
            }}>
              MACD {macdHist > 0 ? '▲' : '▼'}
            </span>
            {/* EMA */}
            <span style={{
              fontSize: '0.68rem', fontWeight: 600, padding: '3px 8px', borderRadius: 6,
              background: ema9Above ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)',
              color: ema9Above ? '#34d399' : '#fb7185',
              border: `1px solid ${ema9Above ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)'}`,
            }}>
              EMA {ema9Above ? 'Bull' : 'Bear'}
            </span>
            {/* Volume */}
            <span style={{
              fontSize: '0.68rem', fontWeight: 600, padding: '3px 8px', borderRadius: 6,
              background: volHigh ? 'rgba(245,158,11,0.1)' : 'rgba(100,116,139,0.07)',
              color: volHigh ? '#fbbf24' : '#64748b',
              border: `1px solid ${volHigh ? 'rgba(245,158,11,0.25)' : 'rgba(100,116,139,0.1)'}`,
            }}>
              {volHigh ? '⚡ Vol Spike' : 'Vol OK'}
            </span>
          </div>

          {/* ── Row 5: Confluence score bar ── */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, alignItems: 'center' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Confluence
              </span>
              <span style={{
                fontSize: '0.7rem', fontFamily: 'var(--font-geist-mono)', fontWeight: 700,
                color: score >= threshold ? '#10b981' : score >= threshold * 0.7 ? '#f59e0b' : 'var(--text-muted)',
              }}>
                {score > 0 ? `${score} / 100` : '—'}
                {score >= threshold ? '  ✓ ENTRY' : score > 0 ? `  (need ${threshold - score} more)` : ''}
              </span>
            </div>
            <div style={{ height: 3, borderRadius: 99, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
              <div style={{
                height: 3,
                width: `${Math.min(100, score)}%`,
                borderRadius: 99,
                background: score >= threshold
                  ? 'linear-gradient(90deg,#3b82f6,#10b981)'
                  : score >= threshold * 0.7
                  ? 'linear-gradient(90deg,#3b82f6,#f59e0b)'
                  : '#334155',
                transition: 'width 0.6s ease',
              }} />
            </div>
          </div>

          {/* ── Row 6: Targets / Exit info ── */}
          {coin.signal === 'SELL' ? (
            /* SELL card: show closed position details */
            <div style={{
              borderRadius: 12, padding: '12px 14px',
              background: isPnlPos ? 'rgba(16,185,129,0.07)' : 'rgba(244,63,94,0.07)',
              border: `1px solid ${isPnlPos ? 'rgba(16,185,129,0.25)' : 'rgba(244,63,94,0.25)'}`,
            }}>
              <div style={{ fontSize: '0.68rem', color: '#fb7185', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                🔴 Position Closed
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: '0.7rem', fontFamily: 'var(--font-geist-mono)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Entry</span>
                <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
                  ${pos?.entryPrice?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? '—'}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>Exit (now)</span>
                <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
                  ${coin.price?.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>P&L</span>
                <span style={{ color: isPnlPos ? '#34d399' : '#fb7185', fontWeight: 700, textAlign: 'right' }}>
                  {isPnlPos ? '+' : ''}₹{pnlINR.toFixed(1)}
                </span>
              </div>
            </div>
          ) : targets ? (
            /* BUY or HOLD card: show targets */
            <div style={{
              borderRadius: 12, padding: '12px 14px',
              background: coin.signal === 'BUY' ? 'rgba(16,185,129,0.06)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${coin.signal === 'BUY' ? 'rgba(16,185,129,0.2)' : 'var(--border-subtle)'}`,
            }}>
              <div style={{
                fontSize: '0.65rem', fontWeight: 700, marginBottom: 8,
                textTransform: 'uppercase', letterSpacing: '0.07em',
                color: coin.signal === 'BUY' ? '#34d399' : 'var(--text-muted)',
              }}>
                {coin.signal === 'BUY' ? '🟢 Entry Targets' : '⚪ Reference Levels'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {[
                  {
                    label: 'Stop Loss',
                    val: `$${targets.stopLoss.toFixed(4)}`,
                    pct: `-${targets.stopPct}%`,
                    inr: `-₹${(targets.stopPct / 100 * 1000).toFixed(0)}`,
                    color: '#fb7185',
                  },
                  {
                    label: 'TP1 — Take 50%',
                    val: `$${targets.tp1.toFixed(4)}`,
                    pct: `+${targets.tp1Pct}%`,
                    inr: `+₹${targets.tp1INR}`,
                    color: '#fbbf24',
                  },
                  {
                    label: 'TP2 — Sell All',
                    val: `$${targets.tp2.toFixed(4)}`,
                    pct: `+${targets.tp2Pct}%`,
                    inr: `+₹${targets.tp2INR}`,
                    color: '#34d399',
                  },
                ].map(row => (
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{row.label}</span>
                      <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-geist-mono)', color: 'var(--text-secondary)', marginLeft: 6 }}>{row.val}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-geist-mono)', fontWeight: 700, color: row.color }}>{row.inr}</span>
                      <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginLeft: 4 }}>{row.pct}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* ── Row 7: Forecast ── */}
          {coin.forecast && coin.forecast.prediction !== 'Market Watching' && (
            <div style={{
              borderRadius: 12, padding: '10px 14px',
              background: coin.forecast.trend === 'bullish'
                ? 'rgba(16,185,129,0.05)' : 'rgba(59,130,246,0.05)',
              border: `1px solid ${coin.forecast.trend === 'bullish'
                ? 'rgba(16,185,129,0.15)' : 'rgba(59,130,246,0.15)'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {coin.forecast.prediction}
                  </div>
                  <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    StochRSI velocity: {coin.forecast.velocity > 0 ? '+' : ''}{coin.forecast.velocity}
                  </div>
                </div>
                <span style={{
                  fontSize: '0.7rem', fontFamily: 'var(--font-geist-mono)', fontWeight: 700,
                  padding: '4px 8px', borderRadius: 8,
                  background: 'rgba(245,158,11,0.1)', color: '#fbbf24',
                  border: '1px solid rgba(245,158,11,0.2)',
                }}>
                  {coin.forecast.timeFrame}
                </span>
              </div>
            </div>
          )}

          {/* ── Row 8: Active position ── */}
          {hasTrade && coin.signal !== 'SELL' ? (
            <div style={{
              borderRadius: 12, padding: '10px 14px',
              background: isPnlPos ? 'rgba(16,185,129,0.07)' : 'rgba(244,63,94,0.07)',
              border: `1px solid ${isPnlPos ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.68rem', color: '#60a5fa', fontWeight: 700 }}>● OPEN LONG</span>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-geist-mono)', fontWeight: 700, fontSize: '0.9rem', color: isPnlPos ? '#34d399' : '#fb7185' }}>
                    {isPnlPos ? '+' : ''}₹{pnlINR.toFixed(1)}
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', marginTop: 8, fontSize: '0.68rem', fontFamily: 'var(--font-geist-mono)', color: 'var(--text-muted)' }}>
                <span>Entry: ${pos!.entryPrice?.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                <span>SL: ${pos!.stopLossPrice?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? '—'}</span>
                <span>TP1: ${pos!.takeProfitLevel1?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? '—'}</span>
                <span>TP2: ${pos!.targetPriceMax?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? '—'}</span>
              </div>
            </div>
          ) : coin.signal === 'HOLD' && !hasTrade ? (
            <div style={{
              borderRadius: 10, padding: '8px 14px', textAlign: 'center',
              fontSize: '0.7rem', color: 'var(--text-muted)',
              background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)',
            }}>
              Watching — no position open
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Home() {
  const [data, setData]           = useState<BotResponse[]>([]);
  const [loading, setLoading]     = useState(false);
  const [isAuto, setIsAuto]       = useState(false);
  const [logs, setLogs]           = useState<string[]>([]);
  const [error, setError]         = useState<string | null>(null);
  const [lastRun, setLastRun]     = useState<string | null>(null);

  const runBot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/bot');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch');
      const results: BotResponse[] = Array.isArray(json) ? json : [json];
      setData(results);
      setLastRun(new Date().toLocaleTimeString());
      const t = new Date().toLocaleTimeString();
      results.forEach(item => {
        const inr = (item.price * (item.inrRate ?? 88)).toLocaleString('en-IN', { maximumFractionDigits: 0 });
        setLogs(p => [`[${t}] ${item.signal} ${item.symbol} — ₹${inr}`, ...p].slice(0, 80));
      });
    } catch (err: any) {
      setError(err.message);
      setLogs(p => [`[${new Date().toLocaleTimeString()}] ERROR: ${err.message}`, ...p].slice(0, 80));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('bot_autoRun');
    if (saved === 'true') { setIsAuto(true); runBot(); }
  }, []);
  useEffect(() => { localStorage.setItem('bot_autoRun', String(isAuto)); }, [isAuto]);
  useEffect(() => {
    if (!isAuto) return;
    const iv = setInterval(runBot, 600_000);
    return () => clearInterval(iv);
  }, [isAuto, runBot]);

  // Load initial logs
  useEffect(() => {
    (async () => {
      try {
        const q    = query(collection(db, 'bot_logs'), orderBy('timestamp', 'desc'), limit(30));
        const snap = await getDocs(q);
        setLogs(snap.docs.map(d => {
          const x = d.data();
          return `[${new Date(x.timestamp).toLocaleTimeString()}] ${x.level}: ${x.message}`;
        }));
      } catch { /* non-critical */ }
    })();
  }, []);

  const testEmail = async () => {
    try {
      const r = await fetch('/api/test-email');
      const j = await r.json();
      alert(j.success ? '✅ Test email sent!' : '❌ ' + j.error);
    } catch (e: any) { alert('❌ ' + e.message); }
  };

  const buyCount  = data.filter(d => d.signal === 'BUY').length;
  const sellCount = data.filter(d => d.signal === 'SELL').length;
  const openCount = data.filter(d => d.activePosition).length;

  // ── Actions for Navbar ──
  const navActions = (
    <>
      <button onClick={testEmail} className="btn-ghost" style={{ fontSize: '0.78rem' }}>
        Email Test
      </button>
      <button
        onClick={() => setIsAuto(v => !v)}
        className="btn-ghost"
        style={{
          fontSize: '0.78rem',
          color: isAuto ? '#34d399' : 'var(--text-muted)',
          borderColor: isAuto ? 'rgba(16,185,129,0.35)' : 'var(--border-subtle)',
        }}
      >
        <span
          style={{
            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
            background: isAuto ? '#10b981' : '#475569', marginRight: 6,
          }}
          className={isAuto ? 'blink' : ''}
        />
        {isAuto ? 'Auto On' : 'Auto Off'}
      </button>
      <button
        onClick={runBot}
        disabled={loading}
        className="btn-primary"
        style={{ fontSize: '0.78rem', padding: '6px 14px' }}
      >
        {loading ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span className="spin-slow" style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.25)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block' }} />
            Scanning…
          </span>
        ) : '↻ Run Scan'}
      </button>
    </>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <Navbar active="dashboard" actions={navActions} />

      <div style={{ maxWidth: 1536, margin: '0 auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Status bar ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
            {/* Status */}
            <div>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Status</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3 }}>
                <span
                  style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: isAuto ? '#10b981' : loading ? '#f59e0b' : '#475569',
                  }}
                  className={isAuto || loading ? 'blink' : ''}
                />
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: isAuto ? '#34d399' : loading ? '#fbbf24' : 'var(--text-secondary)' }}>
                  {loading ? 'Scanning 8 pairs…' : isAuto ? 'Auto-running (10 min)' : 'Standby'}
                </span>
              </div>
            </div>
            {lastRun && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Last: <span style={{ color: 'var(--text-secondary)' }}>{lastRun}</span>
              </div>
            )}
          </div>
          {/* Signal pills */}
          {data.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {[
                { label: `${buyCount} BUY`,   bg: 'rgba(16,185,129,0.1)', color: '#34d399', border: 'rgba(16,185,129,0.25)' },
                { label: `${sellCount} SELL`, bg: 'rgba(244,63,94,0.1)',  color: '#fb7185', border: 'rgba(244,63,94,0.25)' },
                { label: `${openCount} Open`, bg: 'rgba(59,130,246,0.1)', color: '#60a5fa', border: 'rgba(59,130,246,0.25)' },
                { label: '8 Pairs',           bg: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: 'var(--border-subtle)' },
              ].map(p => (
                <span key={p.label} style={{ fontSize: '0.72rem', fontWeight: 600, padding: '5px 12px', borderRadius: 99, background: p.bg, color: p.color, border: `1px solid ${p.border}` }}>
                  {p.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="fade-in" style={{ borderRadius: 12, padding: '10px 16px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', color: '#fb7185' }}>
            ⚠ {error}
          </div>
        )}

        {/* ── Coin grid ── */}
        {data.length > 0 ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
            gap: 14,
          }}>
            {data.map(coin => <CoinCard key={coin.symbol} coin={coin} />)}
          </div>
        ) : (
          <div className="glass" style={{ borderRadius: 20, padding: '72px 24px', textAlign: 'center', border: '1px dashed var(--border-muted)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>⚡</div>
            <p style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>AlgoBot Ready</p>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 20 }}>
              Scanning BTC · ETH · SOL · BNB · XRP · ADA · AVAX · DOGE
            </p>
            <button onClick={runBot} disabled={loading} className="btn-primary">
              {loading ? 'Initialising…' : 'Run First Scan'}
            </button>
          </div>
        )}

        {/* ── Strategy reference ── */}
        <details style={{ borderRadius: 18, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
          <summary style={{
            padding: '14px 18px', cursor: 'pointer',
            background: 'var(--bg-card)', color: 'var(--text-secondary)',
            fontSize: '0.82rem', fontWeight: 600, userSelect: 'none',
            listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ width: 4, height: 16, borderRadius: 2, background: 'var(--blue)', flexShrink: 0 }} />
            Strategy v4.0 Reference Guide
            <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>click to expand</span>
          </summary>
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '16px 18px 20px', borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 20, fontSize: '0.75rem' }}>
              {[
                { label: 'Entry Score (≥ 55)', rows: [['StochRSI K<20 rising','+30'],['EMA9×EMA21 cross','+25'],['MACD rising','+20'],['Lower BB touch','+15'],['Volume spike 1.5×','+10']] },
                { label: 'Exit Signals', rows: [['ATR Stop Loss −1.5%','🔴'],['ATR Trailing (2×ATR)','🔵'],['StochRSI K>80 turn','🟡'],['EMA bearish cross','🟠'],['EOD 11PM force','⚪']] },
                { label: '₹1000 Targets', rows: [['TP1 (50% exit)','≥ +1.5% = ₹15'],['TP2 (full exit)','≥ +3.0% = ₹30'],['Stop Loss','≤ −1.5% = −₹15'],['Risk:Reward','1:2 min'],['Daily target','₹200–400']] },
                { label: 'Risk Controls', rows: [['Daily trades','20 / day'],['Daily loss cap','$300'],['Circuit breaker','5 losses'],['1H trend filter','Bull/Bear'],['Capital scaling','Streak-based']] },
              ].map(s => (
                <div key={s.label}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 8 }}>{s.label}</div>
                  {s.rows.map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                      <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                      <span style={{ fontFamily: 'var(--font-geist-mono)', color: 'var(--text-secondary)', fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </details>

        {/* ── Activity log ── */}
        <div style={{ borderRadius: 18, overflow: 'hidden', border: '1px solid var(--border-subtle)', background: 'rgba(0,0,0,0.4)' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)',
            background: 'rgba(255,255,255,0.02)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="blink" style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
                Activity Log
              </span>
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{logs.length} entries</span>
          </div>
          <div style={{ height: '220px', overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-geist-mono)' }}>
            {logs.length === 0 && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Awaiting first scan…</span>}
            {logs.map((log, i) => {
              const isBuy  = log.includes(' BUY ');
              const isSell = log.includes(' SELL ');
              const isErr  = log.includes('ERROR');
              const c      = isBuy ? '#34d399' : isSell ? '#fb7185' : isErr ? '#f43f5e' : 'var(--text-muted)';
              return <div key={i} style={{ fontSize: '0.72rem', color: c, lineHeight: 1.5 }}>{log}</div>;
            })}
          </div>
        </div>

      </div>
    </div>
  );
}

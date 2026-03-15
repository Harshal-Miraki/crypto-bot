'use client';

import { useState, useEffect } from 'react';
import { BotService, Position } from '../lib/bot-service';
import { Navbar } from '../components/Navbar';

type Tab = 'active' | 'closed';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pnlPct(trade: Position) {
  if (!trade.pnl || !trade.quantity || !trade.entry_price) return 0;
  return (trade.pnl / (trade.entry_price * trade.quantity)) * 100;
}

function fmtPrice(p?: number) {
  if (p === undefined || p === null) return '—';
  return '$' + p.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function PnLDisplay({ pnl, pct }: { pnl: number; pct: number }) {
  if (pnl === 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const pos = pnl > 0;
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-geist-mono)', fontWeight: 700, fontSize: '0.85rem', color: pos ? '#34d399' : '#fb7185' }}>
        {pos ? '+' : ''}${pnl.toFixed(4)}
      </div>
      <div style={{ fontFamily: 'var(--font-geist-mono)', fontSize: '0.7rem', marginTop: 2, color: pos ? '#10b981' : '#f43f5e' }}>
        {pos ? '+' : ''}{pct.toFixed(2)}%
      </div>
    </div>
  );
}

// ─── Mobile trade card ────────────────────────────────────────────────────────
function TradeCard({ trade, isActive }: { trade: Position; isActive: boolean }) {
  const pnl = trade.pnl ?? 0;
  const pct = pnlPct(trade);
  const pos = pnl > 0;

  const COIN_COLORS: Record<string, string> = {
    BTC: '#f7931a', ETH: '#627eea', SOL: '#9945ff', BNB: '#f3ba2f',
    XRP: '#00aae4', ADA: '#5585ff', AVAX: '#e84142', DOGE: '#c2a633',
  };
  const coin  = trade.symbol.split('/')[0];
  const color = COIN_COLORS[coin] ?? '#94a3b8';

  return (
    <div
      className="fade-in"
      style={{
        borderRadius: 14, padding: '14px 16px',
        background: 'var(--bg-card)',
        border: `1px solid ${isActive ? 'rgba(59,130,246,0.25)' : pos ? 'rgba(16,185,129,0.15)' : pnl < 0 ? 'rgba(244,63,94,0.15)' : 'var(--border-subtle)'}`,
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      {/* Row 1: Symbol + Status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-geist-mono)', fontWeight: 700, fontSize: '0.95rem', color }}>
          {trade.symbol}
        </span>
        {isActive ? (
          <span style={{
            fontSize: '0.68rem', fontWeight: 700, padding: '3px 9px', borderRadius: 99,
            background: 'rgba(59,130,246,0.1)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.25)',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>
            <span className="blink" style={{ width: 5, height: 5, borderRadius: '50%', background: '#60a5fa', display: 'inline-block' }} />
            LIVE
          </span>
        ) : (
          <span style={{
            fontSize: '0.68rem', fontWeight: 600, padding: '3px 9px', borderRadius: 99,
            background: 'rgba(100,116,139,0.1)', color: '#64748b', border: '1px solid rgba(100,116,139,0.15)',
          }}>
            CLOSED
          </span>
        )}
      </div>

      {/* Row 2: Dates */}
      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
        Opened: {new Date(trade.opened_at).toLocaleString()}
        {trade.closed_at && (
          <span style={{ marginLeft: 10 }}>· Closed: {new Date(trade.closed_at).toLocaleString()}</span>
        )}
      </div>

      {/* Row 3: Price grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: '0.75rem', fontFamily: 'var(--font-geist-mono)' }}>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.62rem', marginBottom: 2 }}>Entry</div>
          <div style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{fmtPrice(trade.entry_price)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.62rem', marginBottom: 2 }}>{isActive ? 'Stop Loss' : 'Exit'}</div>
          <div style={{ color: isActive ? '#fb7185' : 'var(--text-secondary)', fontWeight: 600 }}>
            {isActive ? fmtPrice(trade.stopLossPrice) : fmtPrice(trade.exit_price)}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.62rem', marginBottom: 2 }}>TP1</div>
          <div style={{ color: '#fbbf24', fontWeight: 600 }}>{fmtPrice(trade.takeProfitLevel1)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.62rem', marginBottom: 2 }}>TP2 Max</div>
          <div style={{ color: '#fbbf24', fontWeight: 600 }}>{fmtPrice(trade.targetPriceMax)}</div>
        </div>
      </div>

      {/* Row 4: P&L bar */}
      {pnl !== 0 && (
        <div style={{
          borderRadius: 10, padding: '8px 12px',
          background: pos ? 'rgba(16,185,129,0.07)' : 'rgba(244,63,94,0.07)',
          border: `1px solid ${pos ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)'}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Realised P&L</span>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-geist-mono)', fontWeight: 700, color: pos ? '#34d399' : '#fb7185' }}>
              {pos ? '+' : ''}${pnl.toFixed(4)}
            </div>
            <div style={{ fontFamily: 'var(--font-geist-mono)', fontSize: '0.7rem', color: pos ? '#10b981' : '#f43f5e' }}>
              {pos ? '+' : ''}{pct.toFixed(2)}%
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Desktop table ────────────────────────────────────────────────────────────
function TradeTable({ trades, isActive }: { trades: Position[]; isActive: boolean }) {
  const COIN_COLORS: Record<string, string> = {
    BTC: '#f7931a', ETH: '#627eea', SOL: '#9945ff', BNB: '#f3ba2f',
    XRP: '#00aae4', ADA: '#5585ff', AVAX: '#e84142', DOGE: '#c2a633',
  };

  return (
    <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Opened', 'Symbol', 'Entry', 'Stop Loss', 'TP1', 'TP2 (Sell)', isActive ? 'Current Exit' : 'Exit Price', 'P&L', 'Status'].map(h => (
                <th key={h} style={{ textAlign: h === 'P&L' ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map(trade => {
              const pnl    = trade.pnl ?? 0;
              const pct    = pnlPct(trade);
              const isOpen = trade.status === 'OPEN';
              const coin   = trade.symbol.split('/')[0];
              return (
                <tr key={trade.id}>
                  <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: '0.75rem' }}>
                    <div>{new Date(trade.opened_at).toLocaleDateString()}</div>
                    <div style={{ marginTop: 2, color: 'var(--text-muted)' }}>{new Date(trade.opened_at).toLocaleTimeString()}</div>
                  </td>
                  <td>
                    <span style={{ fontFamily: 'var(--font-geist-mono)', fontWeight: 700, fontSize: '0.85rem', color: COIN_COLORS[coin] ?? 'var(--text-primary)' }}>
                      {trade.symbol}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-geist-mono)', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                    {fmtPrice(trade.entry_price)}
                  </td>
                  <td style={{ fontFamily: 'var(--font-geist-mono)', color: '#fb7185', fontSize: '0.8rem' }}>
                    {fmtPrice(trade.stopLossPrice)}
                  </td>
                  <td style={{ fontFamily: 'var(--font-geist-mono)', color: '#fbbf24', fontSize: '0.8rem' }}>
                    {fmtPrice(trade.takeProfitLevel1)}
                  </td>
                  <td style={{ fontFamily: 'var(--font-geist-mono)', color: '#34d399', fontSize: '0.8rem', fontWeight: 700 }}>
                    {fmtPrice(trade.targetPriceMax)}
                  </td>
                  <td style={{ fontFamily: 'var(--font-geist-mono)', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                    {isOpen ? (trade.stopLossPrice ? fmtPrice(trade.stopLossPrice) : 'Live') : fmtPrice(trade.exit_price)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <PnLDisplay pnl={pnl} pct={pct} />
                  </td>
                  <td>
                    {isOpen ? (
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: 'rgba(59,130,246,0.1)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.25)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span className="blink" style={{ width: 5, height: 5, borderRadius: '50%', background: '#60a5fa', display: 'inline-block' }} />
                        LIVE
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '3px 9px', borderRadius: 99, background: 'rgba(100,116,139,0.1)', color: '#64748b', border: '1px solid rgba(100,116,139,0.15)' }}>
                        CLOSED
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function HistoryPage() {
  const [closed, setClosed]   = useState<Position[]>([]);
  const [active, setActive]   = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState<Tab>('active');

  useEffect(() => {
    (async () => {
      try {
        const [hist, act] = await Promise.all([
          BotService.getTradeHistory(50),
          BotService.getActivePositions(),
        ]);
        setClosed(hist);
        setActive(act);
      } catch { /* non-critical */ }
      finally { setLoading(false); }
    })();
  }, []);

  const tableData = tab === 'active' ? active : closed;

  const totalPnL = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const wins     = closed.filter(t => (t.pnl ?? 0) > 0).length;
  const winRate  = closed.length ? Math.round(wins / closed.length * 100) : null;

  const navActions = (
    <button onClick={() => window.location.reload()} className="btn-ghost" style={{ fontSize: '0.78rem' }}>
      ↻ Refresh
    </button>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <Navbar active="history" actions={navActions} />

      <div style={{ maxWidth: 1536, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Header */}
        <div>
          <h1 className="gradient-text" style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 }}>Trade Log</h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            All bot positions — stored automatically even when app is closed
          </p>
        </div>

        {/* Summary cards */}
        {!loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {[
              { label: 'Active', value: active.length, color: '#60a5fa' },
              { label: 'Closed', value: closed.length, color: 'var(--text-secondary)' },
              {
                label: 'Total P&L',
                value: (totalPnL >= 0 ? '+' : '') + '$' + totalPnL.toFixed(4),
                color: totalPnL >= 0 ? '#34d399' : '#fb7185',
              },
              {
                label: 'Win Rate',
                value: winRate !== null ? `${winRate}%` : '—',
                color: '#fbbf24',
              },
            ].map(c => (
              <div key={c.label} className="glass" style={{ borderRadius: 14, padding: '14px 16px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{c.label}</div>
                <div style={{ fontFamily: 'var(--font-geist-mono)', fontWeight: 700, fontSize: '1.35rem', color: c.color }}>{c.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8 }}>
          {(['active', 'closed'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '7px 16px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                background: tab === t ? 'rgba(59,130,246,0.12)' : 'transparent',
                color: tab === t ? '#60a5fa' : 'var(--text-muted)',
                border: `1px solid ${tab === t ? 'rgba(59,130,246,0.3)' : 'var(--border-subtle)'}`,
                transition: 'all 0.2s',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {t === 'active' && (
                <span className="blink" style={{ width: 6, height: 6, borderRadius: '50%', background: '#60a5fa', display: 'inline-block' }} />
              )}
              {t === 'active' ? `Active (${active.length})` : `Closed (${closed.length})`}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ padding: '80px 0', textAlign: 'center' }}>
            <div className="spin-slow" style={{ width: 24, height: 24, border: '2px solid rgba(59,130,246,0.2)', borderTopColor: '#60a5fa', borderRadius: '50%', margin: '0 auto 12px' }} />
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Loading trade data…</p>
          </div>
        ) : tableData.length === 0 ? (
          <div className="glass" style={{ borderRadius: 18, padding: '60px 24px', textAlign: 'center', border: '1px dashed var(--border-muted)' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {tab === 'active' ? 'No open positions right now.' : 'No closed trades yet.'}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop: table */}
            <div className="desktop-table">
              <style>{`.desktop-table{display:block}.mobile-cards{display:none}@media(max-width:767px){.desktop-table{display:none}.mobile-cards{display:flex}}`}</style>
              <TradeTable trades={tableData} isActive={tab === 'active'} />
            </div>
            {/* Mobile: cards */}
            <div className="mobile-cards" style={{ flexDirection: 'column', gap: 10 }}>
              {tableData.map(t => <TradeCard key={t.id} trade={t} isActive={tab === 'active'} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

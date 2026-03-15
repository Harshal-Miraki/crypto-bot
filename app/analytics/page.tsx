'use client';

import { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine
} from 'recharts';
import { db } from '../lib/firebase';
import { collection, query, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';
import { Navbar } from '../components/Navbar';

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value as number;
  return (
    <div className="rounded-xl px-3 py-2 text-xs"
      style={{ background: '#0c0c1d', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
      <div style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="font-mono font-bold mt-0.5" style={{ color: val >= 0 ? '#34d399' : '#fb7185' }}>
        {val >= 0 ? '+' : ''}${val.toFixed(4)}
      </div>
    </div>
  );
}

// ─── Metric Card ─────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, color, icon }: {
  label: string; value: string; sub?: string; color: string; icon: string;
}) {
  return (
    <div className="glass rounded-2xl p-5 space-y-3" style={{ border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span className="text-lg">{icon}</span>
      </div>
      <div className="font-mono font-bold text-3xl" style={{ color }}>{value}</div>
      {sub && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

export default function AnalyticsPage() {
  const [stats, setStats]           = useState<any>(null);
  const [pnlHistory, setPnlHistory] = useState<any[]>([]);
  const [tradeLog, setTradeLog]     = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // Daily stats
        const statsSnap = await getDoc(doc(db, 'bot_stats', 'daily_stats'));
        if (statsSnap.exists()) setStats(statsSnap.data());

        // Trade logs for PnL chart
        const logsQ   = query(collection(db, 'bot_logs'), orderBy('timestamp', 'desc'), limit(100));
        const logsSnap = await getDocs(logsQ);
        const rawLogs  = logsSnap.docs.map(d => d.data());

        // Build PnL history from TRADE logs that contain a PnL value
        const tradeLogs = rawLogs
          .filter(d => d.level === 'TRADE' && d.message.includes('PnL:'))
          .reverse();

        let cumulative = 0;
        const chartData = tradeLogs.map(d => {
          const match = d.message.match(/PnL: \$([0-9.-]+)/);
          const pnl   = match ? parseFloat(match[1]) : 0;
          cumulative += pnl;
          return {
            time: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            cumulative: Number(cumulative.toFixed(4)),
            pnl: Number(pnl.toFixed(4)),
          };
        });

        setPnlHistory(chartData);
        setTradeLog(tradeLogs.reverse().slice(0, 10));
      } catch (e) {
        console.error('Analytics error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totalPnL   = pnlHistory.length ? pnlHistory[pnlHistory.length - 1].cumulative : 0;
  const winCount   = pnlHistory.filter(d => d.pnl > 0).length;
  const lossCount  = pnlHistory.filter(d => d.pnl < 0).length;
  const winRate    = pnlHistory.length ? Math.round(winCount / pnlHistory.length * 100) : 0;
  const avgWin     = winCount ? pnlHistory.filter(d => d.pnl > 0).reduce((s, d) => s + d.pnl, 0) / winCount : 0;
  const avgLoss    = lossCount ? Math.abs(pnlHistory.filter(d => d.pnl < 0).reduce((s, d) => s + d.pnl, 0) / lossCount) : 0;
  const riskReward = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : '—';

  const capitalINR = 1000;
  const pnlINR     = totalPnL * (stats?.inrRate ?? 88);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>

      <Navbar active="analytics" actions={
        <button onClick={() => window.location.reload()} className="btn-ghost text-xs">↻ Refresh</button>
      } />

      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold gradient-text">Performance Analytics</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Bot performance metrics and cumulative P&L
          </p>
        </div>

        {loading ? (
          <div className="py-32 text-center">
            <div className="w-6 h-6 border border-blue-500/30 border-t-blue-400 rounded-full spin-slow mx-auto mb-3" />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading analytics…</p>
          </div>
        ) : (
          <>
            {/* Metric Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                label="Cumulative PnL"
                value={(totalPnL >= 0 ? '+' : '') + '$' + totalPnL.toFixed(4)}
                sub={`≈ ${pnlINR >= 0 ? '+' : ''}₹${pnlINR.toFixed(1)} on ₹${capitalINR}`}
                color={totalPnL >= 0 ? '#34d399' : '#fb7185'}
                icon="💰"
              />
              <MetricCard
                label="Win Rate"
                value={`${winRate}%`}
                sub={`${winCount}W / ${lossCount}L from ${pnlHistory.length} trades`}
                color="#fbbf24"
                icon="🎯"
              />
              <MetricCard
                label="Risk : Reward"
                value={`1 : ${riskReward}`}
                sub={`Avg win $${avgWin.toFixed(4)} | Avg loss $${avgLoss.toFixed(4)}`}
                color="#a78bfa"
                icon="⚖️"
              />
              <MetricCard
                label="Today's Stats"
                value={`${stats?.tradesToday ?? 0} / 20`}
                sub={`Streak: ${stats?.consecutiveWins ?? 0}W / ${stats?.consecutiveLosses ?? 0}L`}
                color="#60a5fa"
                icon="📊"
              />
            </div>

            {/* Daily controls cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="glass rounded-2xl p-5" style={{ border: '1px solid var(--border-subtle)' }}>
                <div className="text-xs mb-3 font-medium uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Daily P&L</div>
                <div className="font-mono text-2xl font-bold" style={{ color: (stats?.dailyPnL ?? 0) >= 0 ? '#34d399' : '#fb7185' }}>
                  {(stats?.dailyPnL ?? 0) >= 0 ? '+' : ''}${(stats?.dailyPnL ?? 0).toFixed(4)}
                </div>
                <div className="mt-3">
                  <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                    <span>Daily limit: $300 loss</span>
                    <span>{Math.min(100, Math.abs(Math.min(0, stats?.dailyPnL ?? 0)) / 300 * 100).toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.min(100, Math.abs(Math.min(0, stats?.dailyPnL ?? 0)) / 300 * 100)}%`, background: '#f43f5e' }} />
                  </div>
                </div>
              </div>

              <div className="glass rounded-2xl p-5" style={{ border: '1px solid var(--border-subtle)' }}>
                <div className="text-xs mb-3 font-medium uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Trades Consumed</div>
                <div className="font-mono text-2xl font-bold" style={{ color: '#60a5fa' }}>
                  {stats?.tradesToday ?? 0} <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>/ 20</span>
                </div>
                <div className="mt-3">
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.min(100, ((stats?.tradesToday ?? 0) / 20) * 100)}%`, background: 'linear-gradient(90deg, #3b82f6, #7c3aed)' }} />
                  </div>
                  <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    <span>0</span><span>20 trades / day</span>
                  </div>
                </div>
              </div>

              <div className="glass rounded-2xl p-5" style={{ border: '1px solid var(--border-subtle)' }}>
                <div className="text-xs mb-3 font-medium uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Capital Scaling</div>
                <div className="font-mono text-2xl font-bold" style={{ color: '#fbbf24' }}>
                  ₹{stats?.consecutiveWins >= 3 ? 1300 : stats?.consecutiveWins >= 2 ? 1150 : stats?.consecutiveLosses >= 3 ? 600 : stats?.consecutiveLosses >= 2 ? 800 : 1000}
                </div>
                <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                  {(stats?.consecutiveWins ?? 0) >= 2
                    ? `🔥 Hot streak — scaling up (+${stats?.consecutiveWins >= 3 ? 30 : 15}%)`
                    : (stats?.consecutiveLosses ?? 0) >= 2
                    ? `🧊 Cold streak — scaling down (−${stats?.consecutiveLosses >= 3 ? 40 : 20}%)`
                    : '⚖️ Neutral — base capital ₹1000'}
                </div>
              </div>
            </div>

            {/* PnL Chart */}
            <div className="glass rounded-2xl p-6" style={{ border: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-1 h-4 rounded-full" style={{ background: 'var(--blue)' }} />
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Cumulative P&L Curve</h2>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Based on closed positions from bot logs</p>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold" style={{ color: totalPnL >= 0 ? '#34d399' : '#fb7185' }}>
                    {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(4)}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Total</div>
                </div>
              </div>

              {pnlHistory.length > 1 ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={pnlHistory} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={totalPnL >= 0 ? '#10b981' : '#f43f5e'} stopOpacity={0.2} />
                          <stop offset="95%" stopColor={totalPnL >= 0 ? '#10b981' : '#f43f5e'} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                      <Tooltip content={<ChartTooltip />} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" />
                      <Area
                        type="monotone" dataKey="cumulative"
                        stroke={totalPnL >= 0 ? '#10b981' : '#f43f5e'}
                        strokeWidth={2} fill="url(#pnlGrad)" dot={false}
                        activeDot={{ r: 4, fill: totalPnL >= 0 ? '#10b981' : '#f43f5e', strokeWidth: 0 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-72 flex items-center justify-center rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed var(--border-subtle)' }}>
                  <div className="text-center">
                    <div className="text-2xl mb-2">📈</div>
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Chart will appear after first closed trades</p>
                  </div>
                </div>
              )}
            </div>

            {/* Recent Trades Table */}
            {tradeLog.length > 0 && (
              <div className="glass rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
                <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Recent Trade Log</span>
                </div>
                <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                  {tradeLog.map((d, i) => {
                    const match  = d.message.match(/PnL: \$([0-9.-]+)/);
                    const pnl    = match ? parseFloat(match[1]) : 0;
                    const isWin  = pnl > 0;
                    const isLoss = pnl < 0;
                    return (
                      <div key={i} className="px-5 py-3 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: isWin ? '#10b981' : isLoss ? '#f43f5e' : '#475569' }} />
                          <span className="text-xs font-mono truncate" style={{ color: 'var(--text-secondary)' }}>{d.message}</span>
                        </div>
                        <div className="text-xs font-mono font-semibold shrink-0" style={{ color: isWin ? '#34d399' : isLoss ? '#fb7185' : 'var(--text-muted)' }}>
                          {pnl !== 0 ? `${isWin ? '+' : ''}$${pnl.toFixed(4)}` : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

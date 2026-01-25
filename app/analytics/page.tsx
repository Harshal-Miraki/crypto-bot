'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { db } from '../lib/firebase';
import { collection, query, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';

export default function AnalyticsPage() {
    const [stats, setStats] = useState<any>(null);
    const [pnlHistory, setPnlHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchData() {
            try {
                // 1. Fetch Daily Stats
                const statsRef = doc(db, 'bot_stats', 'daily_stats');
                const statsSnap = await getDoc(statsRef);
                if (statsSnap.exists()) {
                    setStats(statsSnap.data());
                }

                // 2. Fetch recent trade history for the chart
                // We'll use bot_logs where level='TRADE' to reconstruct PnL curve
                const logsQ = query(
                    collection(db, 'bot_logs'),
                    orderBy('timestamp', 'desc'),
                    limit(50)
                );
                const logsSnap = await getDocs(logsQ);
                const data = logsSnap.docs
                    .map(d => d.data())
                    .filter(d => d.level === 'TRADE' && d.message.includes('PnL')) // Only closed trades
                    .map(d => {
                        // Extract PnL from message "PnL: $12.50"
                        const match = d.message.match(/PnL: \$([0-9.-]+)/);
                        return {
                            time: new Date(d.timestamp).toLocaleTimeString(),
                            pnl: match ? parseFloat(match[1]) : 0
                        };
                    })
                    .reverse();

                // Calculate cumulative PnL
                let cumulative = 0;
                const chartData = data.map(d => {
                    cumulative += d.pnl;
                    return { time: d.time, value: cumulative };
                });

                setPnlHistory(chartData);
            } catch (err) {
                console.error('Error loading analytics:', err);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    if (loading) return <div className="p-8 text-gray-400">Loading Analytics...</div>;

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8">
            <div className="max-w-6xl mx-auto space-y-8">
                <header className="border-b border-gray-700 pb-4 flex justify-between items-center">
                    <h1 className="text-3xl font-bold text-blue-400">Performance Analytics</h1>
                    <a href="/" className="text-gray-400 hover:text-white transition-colors">← Back to Bot</a>
                </header>

                {/* Key Metrics Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                        <span className="text-gray-400 text-sm">Daily PnL</span>
                        <div className={`text-3xl font-bold mt-2 ${stats?.dailyPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            ${stats?.dailyPnL?.toFixed(2) || '0.00'}
                        </div>
                    </div>

                    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                        <span className="text-gray-400 text-sm">Win Streak</span>
                        <div className="text-3xl font-bold mt-2 text-yellow-400">
                            {stats?.consecutiveWins || 0} 🔥
                        </div>
                    </div>

                    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                        <span className="text-gray-400 text-sm">Trades Today</span>
                        <div className="text-3xl font-bold mt-2 text-blue-400">
                            {stats?.tradesToday || 0} <span className="text-sm text-gray-500">/ 3</span>
                        </div>
                    </div>

                    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                        <span className="text-gray-400 text-sm">Risk Per Trade</span>
                        <div className="text-3xl font-bold mt-2 text-purple-400">
                            {/* Dynamically calculate based on streak */}
                            ${(stats?.consecutiveWins >= 2 ? 120 : stats?.consecutiveLosses >= 2 ? 60 : 100)}
                        </div>
                        <span className="text-xs text-gray-500">Based on momentum</span>
                    </div>
                </div>

                {/* PnL Chart */}
                <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                    <h2 className="text-xl font-semibold mb-6 text-gray-300">Cumulative Performance</h2>
                    <div className="h-80 w-full">
                        {pnlHistory.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={pnlHistory}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                    <XAxis dataKey="time" stroke="#9CA3AF" />
                                    <YAxis stroke="#9CA3AF" />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151' }}
                                        itemStyle={{ color: '#E5E7EB' }}
                                    />
                                    <Line type="monotone" dataKey="value" stroke="#10B981" strokeWidth={3} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="flex items-center justify-center h-full text-gray-600">
                                No closed trades yet to display chart.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

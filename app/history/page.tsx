'use client';

import { useState, useEffect } from 'react';
import { BotService, Position } from '../lib/bot-service';
import Link from 'next/link';

export default function HistoryPage() {
    const [trades, setTrades] = useState<Position[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadHistory() {
            const data = await BotService.getTradeHistory();
            setTrades(data);
            setLoading(false);
        }
        loadHistory();
    }, []);

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8">
            <div className="max-w-6xl mx-auto">
                <header className="flex justify-between items-center border-b border-gray-700 pb-4 mb-8">
                    <div className="flex items-center space-x-4">
                        <Link href="/" className="text-gray-400 hover:text-white transition-colors">
                            ← Back to Dashboard
                        </Link>
                        <h1 className="text-3xl font-bold text-blue-400">Trade History</h1>
                    </div>
                    <button
                        onClick={() => window.location.reload()}
                        className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm transition-colors"
                    >
                        Refresh
                    </button>
                </header>

                {loading ? (
                    <div className="text-center py-12 text-gray-500 animate-pulse">Loading trade history...</div>
                ) : trades.length === 0 ? (
                    <div className="text-center py-12 text-gray-500 bg-gray-800 rounded-xl border border-gray-700">
                        No closed trades found yet.
                    </div>
                ) : (
                    <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden shadow-lg">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-gray-700 text-gray-300 text-sm uppercase">
                                        <th className="p-4">Date</th>
                                        <th className="p-4">Symbol</th>
                                        <th className="p-4">Entry</th>
                                        <th className="p-4">Exit</th>
                                        <th className="p-4">PnL ($)</th>
                                        <th className="p-4">PnL (%)</th>
                                        <th className="p-4">Duration</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700">
                                    {trades.map((trade) => {
                                        const pnl = trade.pnl || 0;
                                        const pnlPercent = ((pnl / (trade.entry_price * trade.quantity)) * 100);
                                        const isWin = pnl > 0;

                                        const openTime = new Date(trade.opened_at).getTime();
                                        const closeTime = trade.closed_at ? new Date(trade.closed_at).getTime() : Date.now();
                                        const durationMins = Math.round((closeTime - openTime) / 60000);

                                        return (
                                            <tr key={trade.id} className="hover:bg-gray-750 transition-colors">
                                                <td className="p-4 text-sm text-gray-400">
                                                    {trade.closed_at ? new Date(trade.closed_at).toLocaleString() : '-'}
                                                </td>
                                                <td className="p-4 font-bold font-mono">{trade.symbol}</td>
                                                <td className="p-4 font-mono text-gray-300">
                                                    ${trade.entry_price.toLocaleString()}
                                                </td>
                                                <td className="p-4 font-mono text-gray-300">
                                                    {trade.exit_price ? `$${trade.exit_price.toLocaleString()}` : '-'}
                                                </td>
                                                <td className={`p-4 font-mono font-bold ${isWin ? 'text-green-400' : 'text-red-400'}`}>
                                                    {isWin ? '+' : ''}{pnl.toFixed(2)}
                                                </td>
                                                <td className={`p-4 font-mono ${isWin ? 'text-green-400' : 'text-red-400'}`}>
                                                    {pnlPercent.toFixed(2)}%
                                                </td>
                                                <td className="p-4 text-sm text-gray-500">
                                                    {durationMins}m
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

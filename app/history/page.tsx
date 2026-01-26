'use client';

import { useState, useEffect } from 'react';
import { BotService, Position } from '../lib/bot-service';
import Link from 'next/link';

export default function HistoryPage() {
    const [trades, setTrades] = useState<Position[]>([]);
    const [activeTrades, setActiveTrades] = useState<Position[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadHistory() {
            try {
                const [history, active] = await Promise.all([
                    BotService.getTradeHistory(),
                    BotService.getActivePositions()
                ]);
                setTrades(history);
                setActiveTrades(active);
            } catch (e) {
                console.error("Failed to load history", e);
            } finally {
                setLoading(false);
            }
        }
        loadHistory();
    }, []);

    const renderTable = (data: Position[], isActive: boolean) => (
        <div className="bg-gray-800 rounded-xl border border-gray-700 shadow-lg mb-8">
            <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-700 text-gray-300 text-sm uppercase">
                            <th className="p-4">Date</th>
                            <th className="p-4">Symbol</th>
                            <th className="p-4">Entry</th>
                            <th className="p-4">Target (Max)</th>
                            <th className="p-4">{isActive ? 'Current Price' : 'Exit Price'}</th>
                            <th className="p-4">PnL ($)</th>
                            <th className="p-4">PnL (%)</th>
                            <th className="p-4">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                        {data.map((trade) => {
                            const pnl = trade.pnl || 0;
                            // For active trades, PnL might not be calculated in DB yet, 
                            // but we can't easily calculate real-time here without live price. 
                            // relying on what's in DB or showing '-' for valid realtime.
                            // Actually, BotService.getActivePosition returns PnL if available? 
                            // No, getActivePositions returns raw DB data. 
                            // Let's just show what we have or '-' if 0.
                            const pnlPercent = trade.quantity && trade.entry_price
                                ? ((pnl / (trade.entry_price * trade.quantity)) * 100)
                                : 0;

                            const isWin = pnl > 0;
                            const isOpen = trade.status === 'OPEN';

                            return (
                                <tr key={trade.id} className="hover:bg-gray-750 transition-colors">
                                    <td className="p-4 text-sm text-gray-400">
                                        {new Date(trade.opened_at).toLocaleString()}
                                    </td>
                                    <td className="p-4 font-bold font-mono text-blue-300">{trade.symbol}</td>
                                    <td className="p-4 font-mono text-gray-300">
                                        ${trade.entry_price.toLocaleString()}
                                    </td>
                                    <td className="p-4 font-mono text-yellow-500 font-bold">
                                        {trade.targetPriceMax ? `$${trade.targetPriceMax.toLocaleString()}` : '-'}
                                    </td>
                                    <td className="p-4 font-mono text-gray-300">
                                        {trade.exit_price ? `$${trade.exit_price.toLocaleString()}` : (isOpen ? 'Live' : '-')}
                                    </td>
                                    <td className={`p-4 font-mono font-bold ${isWin ? 'text-green-400' : pnl < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                                        {pnl !== 0 ? `${isWin ? '+' : ''}${pnl.toFixed(2)}` : '-'}
                                    </td>
                                    <td className={`p-4 font-mono ${isWin ? 'text-green-400' : pnl < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                                        {pnl !== 0 ? `${pnlPercent.toFixed(2)}%` : '-'}
                                    </td>
                                    <td className="p-4 text-xs uppercase tracking-wider">
                                        <span className={`px-2 py-1 rounded ${isOpen ? 'bg-blue-900 text-blue-300' : 'bg-gray-700 text-gray-400'}`}>
                                            {trade.status}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8 font-sans">
            <div className="max-w-7xl mx-auto">
                <header className="flex flex-col md:flex-row justify-between items-center border-b border-gray-700 pb-4 mb-8 gap-4">
                    <div className="flex flex-col md:flex-row items-center space-y-2 md:space-y-0 md:space-x-4 text-center md:text-left">
                        <Link href="/" className="text-gray-400 hover:text-white transition-colors">
                            ← Back to Dashboard
                        </Link>
                        <h1 className="text-2xl md:text-3xl font-bold text-transparent bg-clip-text bg-linear-to-r from-blue-400 to-purple-400">
                            Trade Log
                        </h1>
                    </div>
                    <button
                        onClick={() => window.location.reload()}
                        className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm transition-colors w-full md:w-auto"
                    >
                        ↻ Refresh Data
                    </button>
                </header>

                {loading ? (
                    <div className="text-center py-20 text-blue-400 animate-pulse text-xl">Loading trade data...</div>
                ) : (
                    <>
                        {/* Active Trades Section */}
                        <div className="mb-10">
                            <h2 className="text-xl font-bold text-green-400 mb-4 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                                Active Runs
                            </h2>
                            {activeTrades.length === 0 ? (
                                <div className="p-8 bg-gray-800/50 rounded-xl border border-gray-700 text-gray-500 text-center italic">
                                    No bots are currently tracking active positions.
                                </div>
                            ) : renderTable(activeTrades, true)}
                        </div>

                        {/* History Section */}
                        <div>
                            <h2 className="text-xl font-bold text-gray-400 mb-4">Past Performance</h2>
                            {trades.length === 0 ? (
                                <div className="p-8 bg-gray-800 rounded-xl border border-gray-700 text-gray-500 text-center italic">
                                    No closed trades recorded yet.
                                </div>
                            ) : renderTable(trades, false)}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

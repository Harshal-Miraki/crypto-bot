'use client';

import { useState, useEffect } from 'react';
import { BotService, ManualTrade } from '../lib/bot-service';
import { db } from '../lib/firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query } from 'firebase/firestore';
import Link from 'next/link';
import { BotResponse } from '../types';

export default function TrackerPage() {
    const [manualTrades, setManualTrades] = useState<ManualTrade[]>([]);
    const [coin, setCoin] = useState('BTC/USDT');
    const [entryPrice, setEntryPrice] = useState('');
    const [loading, setLoading] = useState(false);
    const [marketData, setMarketData] = useState<Record<string, { price: number, inrRate: number }>>({});

    // Load Trades
    useEffect(() => {
        fetchTrades();
        fetchMarketPrices();
        // Poll prices every 30s
        const interval = setInterval(fetchMarketPrices, 30000);
        return () => clearInterval(interval);
    }, []);

    const fetchTrades = async () => {
        const q = query(collection(db, 'manual_trades'));
        const snapshot = await getDocs(q);
        const trades = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ManualTrade));
        setManualTrades(trades);
    };

    const fetchMarketPrices = async () => {
        try {
            const res = await fetch('/api/bot');
            const data: BotResponse[] = await res.json();
            if (Array.isArray(data)) {
                const map: Record<string, { price: number, inrRate: number }> = {};
                data.forEach(d => {
                    map[d.symbol] = { price: d.price, inrRate: d.inrRate || 88 };
                });
                setMarketData(map);
            }
        } catch (e) { console.error(e); }
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!entryPrice) return;
        setLoading(true);
        try {
            await addDoc(collection(db, 'manual_trades'), {
                symbol: coin,
                entryPrice: parseFloat(entryPrice),
                targetPrice: parseFloat(entryPrice) * 1.03, // 3%
                addedAt: new Date().toISOString()
            });
            setEntryPrice('');
            fetchTrades();
            alert('Tracking Started!');
        } catch (e) {
            alert('Error adding trade');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Stop tracking this trade?')) return;
        await deleteDoc(doc(db, 'manual_trades', id));
        fetchTrades();
    };

    return (
        <div className="min-h-screen bg-transparent text-white p-8 font-sans">
            <div className="max-w-4xl mx-auto space-y-8">

                {/* Header */}
                <header className="flex justify-between items-center border-b border-brand-blue pb-4">
                    <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">Manual Trade Tracker</h1>
                    <Link href="/" className="text-gray-400 hover:text-white transition-colors bg-brand-navy/30 px-4 py-2 rounded-lg border border-brand-blue/30 hover:border-brand-blue">
                        ← Back to Dashboard
                    </Link>
                </header>

                {/* Add Form */}
                <div className="bg-brand-navy/60 backdrop-blur-md p-6 rounded-xl border border-brand-blue">
                    <h2 className="text-xl font-bold mb-4 text-gray-200">Add Signal to Track</h2>
                    <form onSubmit={handleAdd} className="flex gap-4 items-end">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Select Coin</label>
                            <select
                                value={coin} onChange={e => setCoin(e.target.value)}
                                className="bg-brand-black/50 border border-brand-blue/50 rounded px-4 py-2 w-40 text-white focus:border-blue-400 outline-none"
                            >
                                <option className="bg-brand-navy">BTC/USDT</option>
                                <option className="bg-brand-navy">ETH/USDT</option>
                                <option className="bg-brand-navy">SOL/USDT</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Your Entry Price ($)</label>
                            <input
                                type="number" step="0.0001"
                                value={entryPrice} onChange={e => setEntryPrice(e.target.value)}
                                className="bg-brand-black/50 border border-brand-blue/50 rounded px-4 py-2 w-40 text-white focus:border-blue-400 outline-none"
                                placeholder="e.g 95.50"
                            />
                        </div>
                        <button
                            disabled={loading}
                            className="bg-brand-blue hover:bg-brand-navy px-6 py-2 rounded font-bold transition border border-blue-500 shadow-lg">
                            {loading ? 'Adding...' : '+ Start Tracking'}
                        </button>
                    </form>
                </div>

                {/* List */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {manualTrades.map(trade => {
                        const data = marketData[trade.symbol];
                        const currentPrice = data?.price || trade.entryPrice;
                        const inrRate = data?.inrRate || 88;
                        const pnl = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
                        const isProfit = pnl >= 0;

                        const entryINR = trade.entryPrice * inrRate;
                        const currentINR = currentPrice * inrRate;

                        return (
                            <div key={trade.id} className="bg-brand-navy/40 backdrop-blur-md p-6 rounded-xl border border-brand-blue relative overflow-hidden group hover:bg-brand-navy/60 transition-all">
                                <button
                                    onClick={() => handleDelete(trade.id)}
                                    className="absolute top-4 right-4 text-red-400 hover:text-red-300 text-xs border border-red-900/50 px-2 py-1 rounded bg-red-900/10 hover:bg-red-900/30 transition-colors"
                                >
                                    STOP TRACKING
                                </button>
                                <h3 className="text-2xl font-bold mb-1 text-white">{trade.symbol}</h3>
                                <p className="text-xs text-gray-500 mb-4">Added: {new Date(trade.addedAt).toLocaleString()}</p>

                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div className="bg-brand-black/30 p-2 rounded border border-brand-blue/20">
                                        <p className="text-gray-400 text-xs uppercase tracking-wider">Entry Price</p>
                                        <p className="text-lg font-mono font-bold text-white">₹{entryINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                                        <p className="text-xs text-gray-500">${trade.entryPrice.toLocaleString()}</p>
                                    </div>
                                    <div className="bg-brand-black/30 p-2 rounded border border-brand-blue/20">
                                        <p className="text-gray-400 text-xs uppercase tracking-wider">Current Price</p>
                                        <p className="text-lg font-mono font-bold text-white">₹{currentINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                                        <p className="text-xs text-gray-500">${currentPrice.toLocaleString()}</p>
                                    </div>
                                </div>

                                <div className={`mt-4 p-3 rounded ${isProfit ? 'bg-brand-green/20 border border-brand-green' : 'bg-brand-red/20 border border-brand-red'}`}>
                                    <div className="flex justify-between items-center">
                                        <span className="text-sm font-medium">Unrealized PnL:</span>
                                        <span className={`font-bold font-mono text-xl ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                                            {isProfit ? '+' : ''}{pnl.toFixed(2)}%
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {manualTrades.length === 0 && (
                    <p className="text-center text-gray-500 mt-10 p-10 border-2 border-dashed border-brand-blue/30 rounded-xl">
                        No manual trades tracked yet. Start by adding one above.
                    </p>
                )}

            </div>
        </div>
    );
}

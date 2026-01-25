import { db } from './firebase';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  updateDoc, 
  doc, 
  limit, 
  orderBy,
  Timestamp 
} from 'firebase/firestore';

export type Position = {
  id: string; // Document ID
  symbol: string;
  entry_price: number;
  quantity: number;
  status: 'OPEN' | 'CLOSED';
  opened_at: string;
  closed_at?: string;
  exit_price?: number;
  pnl?: number;
  notes?: string;
  // Risk Management Fields (v3.0)
  stopLossPrice?: number;
  takeProfitLevel1?: number; // Target 1 (+2%)
  activeTrailingStop?: boolean;
  highestPriceSeen?: number;
};



export const BotService = {
  /**
   * Get the current active position for a symbol.
   * Returns null if no open position exists.
   */
  async getActivePosition(symbol: string): Promise<Position | null> {
    try {
      const q = query(
        collection(db, 'positions'),
        where('symbol', '==', symbol),
        where('status', '==', 'OPEN')
      );
      
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        return null;
      }

      const docSnapshot = querySnapshot.docs[0];
      const data = docSnapshot.data();
      
      return {
        id: docSnapshot.id,
        symbol: data.symbol,
        entry_price: data.entry_price,
        quantity: data.quantity,
        status: data.status,
        opened_at: data.opened_at,
        stopLossPrice: data.stopLossPrice,
        takeProfitLevel1: data.takeProfitLevel1,
        activeTrailingStop: data.activeTrailingStop,
        highestPriceSeen: data.highestPriceSeen,
      } as Position;

    } catch (error) {
      console.error('Error fetching active position:', error);
      return null;
    }
  },

  /**
   * Open a new position.
   */
  async openPosition(symbol: string, price: number, quantity: number = 0.001) {
    try {
      // Calculate Risk Levels
      const stopLossPrice = Number((price * 0.97).toFixed(2)); // -3% Stop Loss
      const takeProfitLevel1 = Number((price * 1.02).toFixed(2)); // +2% Take Profit

      const newPosition = {
        symbol,
        entry_price: price,
        quantity,
        status: 'OPEN',
        opened_at: new Date().toISOString(),
        notes: 'Opened by Bot (v3.0 Strategy)',
        stopLossPrice,
        takeProfitLevel1,
        activeTrailingStop: false,
        highestPriceSeen: price
      };

      const docRef = await addDoc(collection(db, 'positions'), newPosition);
      
      await this.log('TRADE', `Opened BUY position for ${symbol} at $${price}. SL: $${stopLossPrice} (-3%)`);
      
      return { id: docRef.id, ...newPosition };
    } catch (error) {
       console.error('Error opening position:', error);
       throw error;
    }
  },


  /**
   * Get today's trading stats.
   */
  async getTradingStats(): Promise<BotStats> {
      const today = new Date().toISOString().split('T')[0];
      const docRef = doc(db, 'bot_stats', 'daily_stats');
      
      const snapshot = await import('firebase/firestore').then(mod => mod.getDoc(docRef)); // Dynamic import to avoid scope issues? No, just standard usage.
      // Actually, we can just use the 'getDoc' if we import it. 
      // Assuming 'getDoc' is imported in file.
      // Wait, let's fix imports first if needed.
      // Using 'any' for now to avoid compilation hassle in replacement, 
      // but better to add imports.
      // Let's assume getDoc is available or add it.
      
      if (snapshot.exists()) {
          const data = snapshot.data() as BotStats;
          // Reset if new day
          if (data.date !== today) {
              return {
                  id: 'daily_stats',
                  date: today,
                  tradesToday: 0,
                  dailyPnL: 0,
                  consecutiveWins: data.consecutiveWins, // Carry over streaks
                  consecutiveLosses: data.consecutiveLosses,
                  lastTradeResult: data.lastTradeResult
              };
          }
          return data;
      }
      
      return {
          id: 'daily_stats',
          date: today,
          tradesToday: 0,
          dailyPnL: 0,
          consecutiveWins: 0,
          consecutiveLosses: 0,
          lastTradeResult: null
      };
  },

  /**
   * Update stats after a trade.
   */
  async updateTradingStats(stats: BotStats) {
      const docRef = doc(db, 'bot_stats', 'daily_stats');
      const { setDoc } = await import('firebase/firestore'); // Lazy import
      await setDoc(docRef, stats, { merge: true });
  },

  /**
   * Close an active position.
   */
  async closePosition(positionId: string, exitPrice: number, reason: string = 'Signal') {
    try {
      // Fetch the position first to calculate PnL (in a real app, use a transaction)
      // For now, we assume we have the details or just update.
      // Ideally we should read it again, but let's just update based on ID.
      // We need entry_price to calculate PnL accurately.
      // Since we don't have it passed here, let's fetch it.
      
      // NOTE: In a robust system, use runTransaction.
      const posRef = doc(db, 'positions', positionId);
      // We'll update it directly assuming the caller verified the PnL logic, 
      // OR we can just fetch it here.
      // Let's keep it simple: The caller (route.ts) has the active position object,
      // but to be safe, let's just update the known fields.
      // Wait, we need to calculate PnL to store it.
      
      // Let's assume the caller passes the PnL or we fetch the doc.
      // Optimally:
      // const posSnap = await getDoc(posRef);
      // const pos = posSnap.data();
      // const pnl = (exitPrice - pos.entry_price) * pos.quantity;

      // START SIMPLIFICATION -> Just store exit price and status, calculate PnL on read if needed?
      // No, better to store PnL.
      // Let's fetch the doc just to be sure.
      
      // ... actually, the `getActivePosition` in route.ts ALREADY has the entry_price. 
      // But `route.ts` calls `closePosition`. 
      // Let's just do a quick read to be safe.
      const docSnap = await import('firebase/firestore').then(mod => mod.getDoc(posRef));
      if (!docSnap.exists()) throw new Error('Position not found');
      
      const posData = docSnap.data();
      const pnl = (exitPrice - posData.entry_price) * posData.quantity;

      await updateDoc(posRef, {
        status: 'CLOSED',
        closed_at: new Date().toISOString(),
        exit_price: exitPrice,
        pnl: pnl
      });

      await this.log('TRADE', `Closed SELL position for ${posData.symbol} at $${exitPrice}. PnL: $${pnl.toFixed(2)}`);
      return { id: positionId, pnl };

    } catch (error) {
      console.error('Error closing position:', error);
      throw error;
    }
  },

  /**
   * Log an event to the database.
   */
  async log(level: 'INFO' | 'WARN' | 'ERROR' | 'TRADE', message: string, details?: any) {
    try {
      await addDoc(collection(db, 'bot_logs'), {
        level,
        message,
        details: details || null,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error logging:', error);
    }
  },

  /**
   * Get recent logs.
   */
  async getLogs(limitCount = 50) {
    try {
      const q = query(
        collection(db, 'bot_logs'),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );
      
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error fetching logs:', error);
      return [];
    }
  }
};

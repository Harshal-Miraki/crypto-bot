import { db } from './firebase';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  getDoc,
  setDoc,
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


export type BotStats = {
  id: string; // 'daily_stats'
  date: string; // YYYY-MM-DD
  tradesToday: number;
  dailyPnL: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  lastTradeResult: 'WIN' | 'LOSS' | null;
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
   * Update position fields (e.g. for trailing stop).
   */
  async updatePosition(id: string, updates: Partial<Position>) {
      try {
          const docRef = doc(db, 'positions', id);
          await updateDoc(docRef, updates);
      } catch (error) {
          console.error('Error updating position:', error);
          throw error;
      }
  },


  /**
   * Get today's trading stats.
   */
  async getTradingStats(): Promise<BotStats> {
      const today = new Date().toISOString().split('T')[0];
      const docRef = doc(db, 'bot_stats', 'daily_stats');
      
      const snapshot = await getDoc(docRef);
      
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
      await setDoc(docRef, stats, { merge: true });
  },

  /**
   * Close an active position.
   */
  async closePosition(positionId: string, exitPrice: number, reason: string = 'Signal') {
    try {
      const posRef = doc(db, 'positions', positionId);
      
      const docSnap = await getDoc(posRef);
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
   * Get closed trade history.
   */
  async getTradeHistory(limitCount = 50): Promise<Position[]> {
    try {
      const q = query(
        collection(db, 'positions'),
        where('status', '==', 'CLOSED'),
        orderBy('closed_at', 'desc'),
        limit(limitCount)
      );
      
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Position));
    } catch (error) {
      console.error('Error fetching trade history:', error);
      return [];
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

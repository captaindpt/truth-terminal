import { saveTrades, getStats, saveMarketMeta, getMarketMeta, getTradeCount } from './db.js';
import type { StoredTrade, MarketMeta } from './types.js';

const DATA_API_BASE = 'https://data-api.polymarket.com';
const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

// Market metadata cache to avoid repeated fetches
const marketCache = new Map<string, MarketMeta>();

async function fetchMarketMeta(marketId: string): Promise<MarketMeta | null> {
  // Check memory cache
  if (marketCache.has(marketId)) {
    return marketCache.get(marketId)!;
  }

  // Check DB cache
  const cached = getMarketMeta(marketId);
  if (cached && Date.now() - cached.fetchedAt < 24 * 60 * 60 * 1000) {
    marketCache.set(marketId, cached);
    return cached;
  }

  // Fetch from API
  try {
    const response = await fetch(`${GAMMA_API_BASE}/markets/${marketId}`);
    if (!response.ok) return null;

    const data = await response.json();
    const meta: MarketMeta = {
      id: marketId,
      question: data.question || 'Unknown',
      category: data.category || 'uncategorized',
      endDate: data.endDate || '',
      fetchedAt: Date.now(),
    };

    saveMarketMeta(meta);
    marketCache.set(marketId, meta);
    return meta;
  } catch {
    return null;
  }
}

// Trade from Data API /trades endpoint
interface DataAPITrade {
  proxyWallet: string;
  side: 'BUY' | 'SELL';
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  title: string;
  slug: string;
  eventSlug: string;
  outcome: string;
  transactionHash: string;
}

function parseTradeFromAPI(event: DataAPITrade): StoredTrade {
  return {
    id: event.transactionHash + '_' + event.asset.slice(-8), // unique per trade
    timestamp: event.timestamp * 1000, // convert to ms
    marketId: event.conditionId,
    wallet: event.proxyWallet,
    side: event.side,
    outcome: event.outcome || 'YES',
    size: event.size || 0,
    price: event.price || 0,
    title: event.title || '',
    slug: event.slug || '',
  };
}

// Fetch recent trades from Data API
async function fetchRecentTrades(limit = 500): Promise<StoredTrade[]> {
  try {
    const url = `${DATA_API_BASE}/trades?limit=${limit}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[API] Error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data: DataAPITrade[] = await response.json();

    const trades = data
      .map(parseTradeFromAPI)
      .filter((t: StoredTrade) => t.size >= 1); // Skip dust trades

    return trades;
  } catch (err: any) {
    console.error('[API] Fetch error:', err.message);
    return [];
  }
}

// Polling-based trade collection
export class TradeCollector {
  private isRunning = false;
  private pollInterval = 10000; // 10 seconds
  private totalTrades = 0;
  private startTime = Date.now();
  private lastTimestamp = 0;

  constructor(private onTrade?: (trade: StoredTrade) => void) {}

  async start(): Promise<void> {
    this.isRunning = true;
    this.startTime = Date.now();
    this.totalTrades = getTradeCount();

    console.log('[COLLECTOR] Starting trade collection via Data API polling');
    console.log(`[COLLECTOR] Poll interval: ${this.pollInterval / 1000}s`);

    while (this.isRunning) {
      await this.poll();
      await this.sleep(this.pollInterval);
    }
  }

  private async poll(): Promise<void> {
    const trades = await fetchRecentTrades(100);

    if (trades.length === 0) {
      return;
    }

    // Save trades (duplicates are ignored via INSERT OR IGNORE)
    const newCount = saveTrades(trades);

    if (newCount > 0) {
      this.totalTrades += newCount;
      const elapsed = (Date.now() - this.startTime) / 1000 / 60;
      console.log(`[COLLECTOR] +${newCount} new trades (${this.totalTrades} total, ${elapsed.toFixed(1)} min running)`);

      // Check for whales in new trades
      for (const t of trades) {
        if (t.size >= 5000) {
          console.log(`  [WHALE] $${t.size.toFixed(0)} ${t.side} ${t.outcome} by ${t.wallet.slice(0, 10)}...`);
        }

        // Callback for real-time processing
        if (this.onTrade) {
          this.onTrade(t);
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop(): void {
    this.isRunning = false;
    console.log(`[COLLECTOR] Stopped. Total trades: ${this.totalTrades}`);
  }
}

// Alternative: Fetch trades for a specific wallet
export async function fetchWalletTrades(wallet: string, limit = 500): Promise<StoredTrade[]> {
  try {
    const url = `${DATA_API_BASE}/trades?user=${wallet}&limit=${limit}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[API] Error fetching wallet trades: ${response.status}`);
      return [];
    }

    const data: DataAPITrade[] = await response.json();
    return data.map(parseTradeFromAPI);
  } catch (err: any) {
    console.error('[API] Wallet fetch error:', err.message);
    return [];
  }
}

// Main entry point for streaming
export async function startStreaming(): Promise<void> {
  console.log('='.repeat(60));
  console.log('POLYMARKET TRADE COLLECTOR');
  console.log('='.repeat(60));

  const initialStats = getStats();
  console.log(`[DB] Starting with ${initialStats.trades} trades, ${initialStats.wallets} wallets, ${initialStats.markets} markets`);

  const collector = new TradeCollector((trade) => {
    // Could add real-time pattern detection here later
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[COLLECTOR] Shutting down...');
    collector.stop();
    const stats = getStats();
    console.log(`[DB] Final stats: ${stats.trades} trades, ${stats.wallets} wallets, ${stats.markets} markets`);
    process.exit(0);
  });

  await collector.start();
}

// Run if executed directly
const isMainModule = process.argv[1]?.endsWith('stream.ts') || process.argv[1]?.endsWith('stream.js');
if (isMainModule) {
  startStreaming();
}

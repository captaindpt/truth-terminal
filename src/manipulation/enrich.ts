import { db } from './db.js';
import type { WalletProfile, MarketMeta } from './types.js';

const DATA_API_BASE = 'https://data-api.polymarket.com';
const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

// Rate limiting
const DELAY_MS = 100; // 100ms between API calls
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ============ Wallet Enrichment ============

interface APIWalletTrade {
  timestamp: number;
  size: number;
  price: number;
  conditionId: string;
  outcome: string;
}

export async function enrichWallet(address: string): Promise<WalletProfile | null> {
  try {
    const url = `${DATA_API_BASE}/trades?user=${address}&limit=500`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[ENRICH] Wallet API error: ${response.status}`);
      return null;
    }

    const trades: APIWalletTrade[] = await response.json();

    if (!trades || trades.length === 0) {
      return null;
    }

    const timestamps = trades.map(t => t.timestamp);
    const markets = new Set(trades.map(t => t.conditionId));
    const totalVolume = trades.reduce((sum, t) => sum + (t.size || 0), 0);

    const profile: WalletProfile = {
      address,
      firstSeen: Math.min(...timestamps) * 1000, // convert to ms
      lastSeen: Math.max(...timestamps) * 1000,
      tradeCount: trades.length,
      uniqueMarkets: markets.size,
      totalVolume,
      avgTradeSize: totalVolume / trades.length,
    };

    // Save to DB
    const stmt = db.prepare(`
      INSERT INTO wallet_profiles (address, first_seen, last_seen, trade_count, unique_markets, total_volume, avg_trade_size)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(address) DO UPDATE SET
        first_seen = MIN(first_seen, excluded.first_seen),
        last_seen = MAX(last_seen, excluded.last_seen),
        trade_count = excluded.trade_count,
        unique_markets = excluded.unique_markets,
        total_volume = excluded.total_volume,
        avg_trade_size = excluded.avg_trade_size
    `);

    stmt.run(
      profile.address,
      profile.firstSeen,
      profile.lastSeen,
      profile.tradeCount,
      profile.uniqueMarkets,
      profile.totalVolume,
      profile.avgTradeSize
    );

    return profile;
  } catch (err: any) {
    console.error(`[ENRICH] Wallet error for ${address.slice(0, 10)}:`, err.message);
    return null;
  }
}

// ============ Market Enrichment ============

// Fetch market info from Data API trades (they include title)
export async function enrichMarket(conditionId: string): Promise<MarketMeta | null> {
  try {
    // Get a trade for this market to extract title/slug
    const url = `${DATA_API_BASE}/trades?limit=1`;
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    // Can't easily get market info from condition ID
    // The Data API trades include title, so we'll extract from there
    return null;
  } catch (err: any) {
    return null;
  }
}

// Enrich markets from trade data we already have
export async function enrichMarketsFromTrades(): Promise<number> {
  // Get distinct market titles from recent trades via API
  const url = `${DATA_API_BASE}/trades?limit=500`;
  const response = await fetch(url);

  if (!response.ok) {
    console.error('[ENRICH] Failed to fetch trades for market enrichment');
    return 0;
  }

  const trades = await response.json();
  const marketMap = new Map<string, { title: string; slug: string }>();

  for (const t of trades) {
    if (t.conditionId && t.title) {
      marketMap.set(t.conditionId, {
        title: t.title,
        slug: t.slug || '',
      });
    }
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO market_meta (id, question, category, end_date, fetched_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  let count = 0;
  for (const [conditionId, info] of marketMap) {
    // Extract category from slug (e.g., "eth-updown" -> "crypto", "nhl-" -> "sports")
    let category = 'uncategorized';
    if (info.slug.startsWith('eth-') || info.slug.startsWith('btc-')) category = 'crypto';
    else if (info.slug.startsWith('nhl-') || info.slug.startsWith('nba-') || info.slug.startsWith('nfl-')) category = 'sports';
    else if (info.slug.includes('trump') || info.slug.includes('biden') || info.slug.includes('election')) category = 'politics';
    else if (info.slug.includes('musk') || info.slug.includes('elon')) category = 'tech-personalities';

    stmt.run(conditionId, info.title, category, '', Date.now());
    count++;
  }

  return count;
}

// ============ Batch Enrichment ============

export async function enrichNewWallets(limit = 50): Promise<number> {
  // Find wallets we've seen in trades but haven't enriched yet
  const rows = db.prepare(`
    SELECT DISTINCT t.wallet
    FROM trades t
    LEFT JOIN wallet_profiles wp ON t.wallet = wp.address
    WHERE wp.address IS NULL
    LIMIT ?
  `).all(limit) as { wallet: string }[];

  console.log(`[ENRICH] Found ${rows.length} wallets to enrich`);

  let enriched = 0;
  for (const row of rows) {
    const profile = await enrichWallet(row.wallet);
    if (profile) {
      enriched++;
      const ageDays = (Date.now() - profile.firstSeen) / (1000 * 60 * 60 * 24);
      console.log(`  ${row.wallet.slice(0, 10)}... | ${ageDays.toFixed(0)} days old | ${profile.tradeCount} trades | ${profile.uniqueMarkets} markets | $${profile.totalVolume.toFixed(0)}`);
    }
    await sleep(DELAY_MS);
  }

  return enriched;
}

export async function enrichNewMarkets(limit = 50): Promise<number> {
  console.log(`[ENRICH] Fetching market titles from recent trades...`);
  const count = await enrichMarketsFromTrades();
  console.log(`[ENRICH] Enriched ${count} markets from trade data`);
  return count;
}

// ============ Main ============

async function main() {
  console.log('='.repeat(60));
  console.log('ENRICHMENT: Fetching wallet ages and market metadata');
  console.log('='.repeat(60));
  console.log();

  const walletCount = await enrichNewWallets(100);
  console.log();
  const marketCount = await enrichNewMarkets(100);

  console.log();
  console.log(`Done. Enriched ${walletCount} wallets, ${marketCount} markets.`);
}

const isMainModule = process.argv[1]?.endsWith('enrich.ts') || process.argv[1]?.endsWith('enrich.js');
if (isMainModule) {
  main().catch(console.error);
}

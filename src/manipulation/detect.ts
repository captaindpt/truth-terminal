import { db } from './db.js';
import { saveAlert } from './db.js';
import { enrichWallet, enrichMarket } from './enrich.js';
import type { ManipulationAlert } from './types.js';

// ============ Detection Queries ============

interface SuspiciousWallet {
  wallet: string;
  wallet_age_days: number;
  unique_markets: number;
  total_volume: number;
  avg_price: number;
  trade_count: number;
}

// Find wallets that look like the Venezuela insider pattern:
// - Fresh wallet (< 30 days)
// - Concentrated (few markets)
// - Significant volume
// - Buying at low prices
function findFreshConcentratedWallets(): SuspiciousWallet[] {
  const rows = db.prepare(`
    SELECT
      t.wallet,
      ROUND((julianday('now') - julianday(datetime(wp.first_seen/1000, 'unixepoch'))), 1) as wallet_age_days,
      wp.unique_markets,
      wp.total_volume,
      ROUND(AVG(t.price) * 100, 1) as avg_price,
      COUNT(*) as trade_count
    FROM trades t
    JOIN wallet_profiles wp ON t.wallet = wp.address
    WHERE t.side = 'BUY'
      AND wp.first_seen > (strftime('%s', 'now') - 30*24*60*60) * 1000  -- < 30 days old
      AND wp.unique_markets <= 5  -- concentrated
      AND wp.total_volume > 1000  -- meaningful money
    GROUP BY t.wallet
    HAVING avg_price < 20  -- buying at <20% odds
    ORDER BY wp.total_volume DESC
  `).all() as SuspiciousWallet[];

  return rows;
}

// Find single-market specialists with high volume
function findSingleMarketSpecialists(): any[] {
  const rows = db.prepare(`
    SELECT
      t.wallet,
      t.market_id,
      mm.question,
      COUNT(*) as trades,
      ROUND(SUM(t.size), 0) as total_vol,
      ROUND(AVG(t.price) * 100, 1) as avg_price,
      wp.unique_markets as wallet_total_markets,
      ROUND((julianday('now') - julianday(datetime(wp.first_seen/1000, 'unixepoch'))), 1) as wallet_age_days
    FROM trades t
    JOIN wallet_profiles wp ON t.wallet = wp.address
    LEFT JOIN market_meta mm ON t.market_id = mm.id
    WHERE wp.unique_markets = 1
      AND t.side = 'BUY'
    GROUP BY t.wallet
    HAVING total_vol > 500
    ORDER BY total_vol DESC
    LIMIT 20
  `).all();

  return rows;
}

// Find markets dominated by few wallets (potential coordination)
function findConcentratedMarkets(): any[] {
  const rows = db.prepare(`
    SELECT
      t.market_id,
      mm.question,
      COUNT(DISTINCT t.wallet) as unique_wallets,
      COUNT(*) as trades,
      ROUND(SUM(t.size), 0) as total_vol,
      ROUND(SUM(t.size) / COUNT(DISTINCT t.wallet), 0) as vol_per_wallet
    FROM trades t
    LEFT JOIN market_meta mm ON t.market_id = mm.id
    GROUP BY t.market_id
    HAVING total_vol > 1000 AND unique_wallets <= 3
    ORDER BY vol_per_wallet DESC
    LIMIT 20
  `).all();

  return rows;
}

// Find wallets buying at extreme low prices
function findLowOddsBuyers(): any[] {
  const rows = db.prepare(`
    SELECT
      t.wallet,
      t.market_id,
      mm.question,
      t.size,
      ROUND(t.price * 100, 1) as price_pct,
      ROUND((julianday('now') - julianday(datetime(wp.first_seen/1000, 'unixepoch'))), 1) as wallet_age_days,
      wp.unique_markets,
      wp.total_volume as wallet_total_vol
    FROM trades t
    JOIN wallet_profiles wp ON t.wallet = wp.address
    LEFT JOIN market_meta mm ON t.market_id = mm.id
    WHERE t.side = 'BUY'
      AND t.price < 0.10  -- buying at <10%
      AND t.size > 100    -- meaningful size
    ORDER BY t.size DESC
    LIMIT 30
  `).all();

  return rows;
}

// ============ Main Detection Report ============

async function runDetection() {
  console.log('='.repeat(70));
  console.log('MANIPULATION DETECTION REPORT');
  console.log('='.repeat(70));
  console.log();

  // Check if we have enriched data
  const enrichedWallets = (db.prepare('SELECT COUNT(*) as c FROM wallet_profiles').get() as any).c;
  const enrichedMarkets = (db.prepare('SELECT COUNT(*) as c FROM market_meta').get() as any).c;

  if (enrichedWallets === 0) {
    console.log('No wallet profiles yet. Run: npm run stream:enrich');
    return;
  }

  console.log(`Working with ${enrichedWallets} enriched wallets, ${enrichedMarkets} enriched markets`);
  console.log();

  // 1. Fresh + Concentrated Wallets
  console.log('━'.repeat(70));
  console.log('FRESH CONCENTRATED WALLETS (< 30 days, ≤ 5 markets, buying low)');
  console.log('━'.repeat(70));
  const freshConcentrated = findFreshConcentratedWallets();
  if (freshConcentrated.length === 0) {
    console.log('  None found');
  } else {
    for (const w of freshConcentrated) {
      console.log(`  ${w.wallet.slice(0, 14)}... | ${w.wallet_age_days} days | ${w.unique_markets} mkts | $${w.total_volume.toFixed(0)} | avg ${w.avg_price}%`);
    }
  }
  console.log();

  // 2. Single-Market Specialists
  console.log('━'.repeat(70));
  console.log('SINGLE-MARKET SPECIALISTS (only trade 1 market)');
  console.log('━'.repeat(70));
  const specialists = findSingleMarketSpecialists();
  if (specialists.length === 0) {
    console.log('  None found');
  } else {
    for (const s of specialists) {
      const q = s.question?.slice(0, 40) || s.market_id.slice(0, 20);
      console.log(`  ${s.wallet.slice(0, 12)}... | $${s.total_vol} | ${s.wallet_age_days || '?'} days | ${q}...`);
    }
  }
  console.log();

  // 3. Concentrated Markets
  console.log('━'.repeat(70));
  console.log('CONCENTRATED MARKETS (≤ 3 wallets, high volume)');
  console.log('━'.repeat(70));
  const concentrated = findConcentratedMarkets();
  if (concentrated.length === 0) {
    console.log('  None found');
  } else {
    for (const m of concentrated) {
      const q = m.question?.slice(0, 45) || m.market_id.slice(0, 20);
      console.log(`  ${m.unique_wallets} wallets | $${m.total_vol} | ${q}...`);
    }
  }
  console.log();

  // 4. Low-Odds Buyers
  console.log('━'.repeat(70));
  console.log('LOW-ODDS BUYERS (buying at < 10%)');
  console.log('━'.repeat(70));
  const lowOdds = findLowOddsBuyers();
  if (lowOdds.length === 0) {
    console.log('  None found');
  } else {
    for (const l of lowOdds) {
      const q = l.question?.slice(0, 35) || l.market_id.slice(0, 15);
      console.log(`  ${l.wallet.slice(0, 10)}... | $${l.size.toFixed(0)} @ ${l.price_pct}% | ${l.wallet_age_days || '?'}d old | ${q}...`);
    }
  }
  console.log();

  console.log('='.repeat(70));
  console.log('END REPORT');
  console.log('='.repeat(70));
}

const isMainModule = process.argv[1]?.endsWith('detect.ts') || process.argv[1]?.endsWith('detect.js');
if (isMainModule) {
  runDetection().catch(console.error);
}

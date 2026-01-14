import { getStats, getRecentTrades, getTopWalletsByVolume, getRecentAlerts } from './db.js';

function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatTime(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

function formatUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

async function main() {
  console.log('='.repeat(60));
  console.log('MANIPULATION DETECTION - DATABASE STATS');
  console.log('='.repeat(60));
  console.log();

  const stats = getStats();
  console.log('OVERVIEW');
  console.log('-'.repeat(40));
  console.log(`Total trades:    ${stats.trades.toLocaleString()}`);
  console.log(`Unique wallets:  ${stats.wallets.toLocaleString()}`);
  console.log(`Unique markets:  ${stats.markets.toLocaleString()}`);
  console.log(`Alerts:          ${stats.alerts}`);
  console.log();

  // Recent trades
  const recentTrades = getRecentTrades(10);
  if (recentTrades.length > 0) {
    console.log('RECENT TRADES');
    console.log('-'.repeat(40));
    for (const t of recentTrades) {
      console.log(`${formatTime(t.timestamp)} | ${formatAddress(t.wallet)} | ${t.side.padEnd(4)} ${t.outcome.padEnd(3)} | ${formatUSD(t.size).padStart(8)} @ ${(t.price * 100).toFixed(0)}%`);
    }
    console.log();
  }

  // Top wallets (once we have profile data)
  // For now, compute from trades
  if (stats.trades > 0) {
    console.log('TOP WALLETS BY TRADE COUNT (from raw trades)');
    console.log('-'.repeat(40));

    // Quick aggregation from recent data
    const walletStats = new Map<string, { count: number; volume: number; markets: Set<string> }>();

    // This is inefficient but works for proof of concept
    // In production, we'd run wallet profile computation as a separate job
    const allTrades = getRecentTrades(10000);
    for (const t of allTrades) {
      const w = walletStats.get(t.wallet) || { count: 0, volume: 0, markets: new Set() };
      w.count++;
      w.volume += t.size;
      w.markets.add(t.marketId);
      walletStats.set(t.wallet, w);
    }

    const sorted = Array.from(walletStats.entries())
      .sort((a, b) => b[1].volume - a[1].volume)
      .slice(0, 10);

    for (const [addr, data] of sorted) {
      console.log(`${formatAddress(addr)} | ${data.count.toString().padStart(5)} trades | ${formatUSD(data.volume).padStart(10)} | ${data.markets.size} markets`);
    }
    console.log();
  }

  // Alerts
  const alerts = getRecentAlerts(5);
  if (alerts.length > 0) {
    console.log('RECENT ALERTS');
    console.log('-'.repeat(40));
    for (const a of alerts) {
      console.log(`[${a.severity}] ${a.type}`);
      console.log(`  ${a.details}`);
      console.log(`  Wallets: ${a.wallets.map(formatAddress).join(', ')}`);
      console.log();
    }
  }
}

main().catch(console.error);

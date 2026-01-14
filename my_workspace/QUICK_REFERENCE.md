# Quick Reference

Truth Terminal is expanding into a general-purpose terminal for querying many sources; the commands below reflect the current implemented integrations.

## Commands

```bash
# Manipulation Detection
npm run stream           # Collect trades (background)
npm run stream:enrich    # Fetch wallet ages + market titles
npm run stream:detect    # Run detection report
npm run stream:stats     # Quick stats

# Research
npm run phase0:list              # List top markets
npm run research:agentic <id>    # Full Opus research

# Control
pkill -f "tsx src/manipulation/stream"   # Stop stream
tail -f data/stream.log                  # Watch stream
```

## Key Files

```
src/manipulation/
├── stream.ts    # Trade collector
├── enrich.ts    # Wallet + market enrichment
├── detect.ts    # Detection queries
├── db.ts        # SQLite persistence
├── types.ts     # Type definitions
└── stats.ts     # Quick stats

data/
├── manipulation.db   # Detection data
├── stream.log        # Stream output
└── cases/            # Research cases
```

## SQLite Queries

```bash
# Basic stats
sqlite3 data/manipulation.db "SELECT COUNT(*) FROM trades;"

# Top wallets by volume
sqlite3 data/manipulation.db "
  SELECT substr(wallet,1,12), COUNT(*), ROUND(SUM(size),0)
  FROM trades GROUP BY wallet ORDER BY SUM(size) DESC LIMIT 10;
"

# Fresh wallets with big bets
sqlite3 data/manipulation.db "
  SELECT substr(wp.address,1,12),
         ROUND((julianday('now') - julianday(datetime(wp.first_seen/1000, 'unixepoch'))),1) as days,
         wp.unique_markets, wp.total_volume
  FROM wallet_profiles wp
  WHERE days < 14 AND wp.total_volume > 1000
  ORDER BY wp.total_volume DESC;
"
```

## API Endpoints

```bash
# Recent trades
curl "https://data-api.polymarket.com/trades?limit=10"

# Wallet history
curl "https://data-api.polymarket.com/trades?user=0x..."

# Market list
curl "https://gamma-api.polymarket.com/markets?limit=10"
```

## Detection Thresholds

| Signal | Threshold |
|--------|-----------|
| Fresh wallet | < 14-30 days |
| Concentrated | ≤ 5 markets |
| Low odds | < 15% (suspicious), < 5% (very) |
| Large trade | > $1K (whale), > $100 (signal) |
| Win rate anomaly | > 80% over 10+ markets |

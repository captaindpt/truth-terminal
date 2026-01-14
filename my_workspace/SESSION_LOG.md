# Session Log - Jan 3, 2026

## What We Built Tonight

### Manipulation Detection System

A new subsystem to detect insider trading and market manipulation on Polymarket.

**Location:** `src/manipulation/`

**Files created:**
- `types.ts` - Type definitions for trades, wallets, alerts
- `db.ts` - SQLite persistence (separate DB: `data/manipulation.db`)
- `stream.ts` - Trade collector via Data API polling
- `enrich.ts` - Wallet age + market title enrichment
- `detect.ts` - Detection report with suspicious pattern queries
- `stats.ts` - Quick stats viewer

**Commands:**
```bash
npm run stream          # Collect trades (runs continuously, currently running in background)
npm run stream:enrich   # Fetch wallet ages + market titles from API
npm run stream:detect   # Run detection report
npm run stream:stats    # Quick overview
```

**To stop the stream:** `pkill -f "tsx src/manipulation/stream"`

---

## The Core Insight

From @spacexbt's system that caught the Venezuela insider:

> "Fresh wallets, unusual sizing, repeated entries in niche markets"

Three-part signature:
1. **Wallet age** - new/fresh wallets are suspicious
2. **Size anomaly** - unusual sizing relative to market or wallet history
3. **Recurrence** - repeated entries in niche markets

---

## Ground Truth: The Venezuela Insider

Wallet: `0x31a56e9E690c621eD21De08Cb559e9524Cdb8eD9`

**Pattern:**
- First trade Dec 26, 2025 (8 days before detection)
- 100% Venezuela-related markets (Maduro, invasion, war powers)
- $70K-90K per entry on Maduro
- Buying at 5-9% odds
- Sold Jan 3 at 18-51% after news broke
- Total: ~$350K in at avg ~7%, turned into $442K+

**Detection signature:**
```
wallet_age < 14 days
AND unique_markets <= 5
AND all markets share common entity (Venezuela/Maduro)
AND total_volume > $50K
AND avg_entry_price < 15%
```

---

## What Detection Found (30 min sample)

**LOW-ODDS BUYERS:**
| Wallet | Amount | Price | Age | Market |
|--------|--------|-------|-----|--------|
| `0x54030db9` | $5,036 | 0.2% | 64d | unknown |
| `0x1d949489` | $448 | 3% | 0.2d | Marquette vs UConn (college basketball) |
| `0x07bf7fcc` | $278 | 1.2% | 3.6d | ETH price prediction |

The `0x1d949489` wallet is interesting: 4 hours old, $448 at 3% on a specific sports game.

**CONCENTRATED MARKETS (1-2 wallets dominating):**
- "Supreme Court rules in favor of Trump's tariff" - $1.5K from 1 wallet
- "20+ earthquakes" - $1.2K from 1 wallet
- Various sports games getting single-wallet $1K+ bets

---

## Data Collection Status

As of session end:
- ~1,700 trades collected
- ~30 minutes of data
- 332 wallets enriched with age/history
- 182 markets enriched with titles

**Stream is running in background.** Log at `data/stream.log`.

Projected 12-hour collection: ~100K trades, ~66MB DB.

---

## API Endpoints Used

**Data API** (no auth, free):
- `https://data-api.polymarket.com/trades?limit=N` - Recent trades across all markets
- `https://data-api.polymarket.com/trades?user=WALLET` - Trades for specific wallet

**Gamma API** (no auth, free):
- `https://gamma-api.polymarket.com/markets` - Market metadata
- Note: `condition_id` query doesn't work well, but trade data includes titles

---

## Detection Queries (in detect.ts)

1. **Fresh Concentrated Wallets** - <30 days old, ≤5 markets, buying at <20%
2. **Single-Market Specialists** - Wallet only trades 1 market, significant volume
3. **Concentrated Markets** - ≤3 wallets but high volume
4. **Low-Odds Buyers** - Buying at <10% with meaningful size

---

## Next Steps (not done yet)

1. **Let stream run overnight** - get 12-24h of data
2. **Topic clustering** - group markets by entity (Venezuela, Google, etc.)
3. **Wallet cluster detection** - find wallets that trade together
4. **Real-time alerts** - trigger when pattern matches during collection
5. **Win rate tracking** - needs resolution data from API

---

## Technical Notes

- Polling every 10 seconds via Data API (WebSocket required auth)
- Using `INSERT OR IGNORE` to handle duplicate trades
- Wallet enrichment: one API call per wallet, cached forever
- Market titles come from trade data (not Gamma API)
- Category inference from slug (eth- → crypto, nhl- → sports, etc.)

---

## Mani's Preferences (from CLAUDE.md)

- He's the final intuition layer
- Wants to review fast, not read files manually
- Interested in "edge" - what market isn't pricing
- Prefers Claude and Grok over GPT
- Based in Canada (Polymarket trading allowed)

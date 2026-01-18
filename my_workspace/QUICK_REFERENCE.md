# Quick Reference

Truth Terminal is a **prediction research workstation for timing arbitrage** on Polymarket. The edge is knowing *when* to enter based on information arrival and disciplined execution.

## The Five Core Capabilities (Building Toward)

1. **Watchlist + Conviction Tracker** - Structured theses: your probability vs market, key uncertainties, entry/exit conditions
2. **Polymarket Order Book** - Liquidity assessment: spread, depth, slippage before entry
3. **Information Calendar** - When will data arrive that moves watched markets?
4. **Entry Rule Engine** - Precommitted rules: IF price < X AND conviction > Y THEN buy
5. **Portfolio Dashboard** - Aggregate view: capital deployed, correlation, time-to-resolution, P&L

## Commands

```bash
# UI (Bloomberg-vibes)
npm run ui                    # Local web UI at http://127.0.0.1:7777

# CLI (REPL)
npm run tt                    # Terminal REPL
npm run tt -- --eval "help"   # One-shot command

# Manipulation Detection
npm run stream           # Collect trades (background)
npm run stream:enrich    # Fetch wallet ages + market titles
npm run stream:detect    # Run detection report
npm run stream:stats     # Quick stats

# Research
npm run phase0:list              # List top markets
npm run research:agentic <id>    # Full Opus 4.5 research

# Control
pkill -f "tsx src/manipulation/stream"   # Stop stream
tail -f data/stream.log                  # Watch stream
```

## UI Notes

- **Working windows**: topbar center shows only windows currently open in this workspace (click to focus)
- **Windows**: drag header, resize corners, close `×` to remove from working windows; reopen via `WIN` → `Launch`
- **Workspaces**: bottom tabs (add `+` at the far right, remove `×`, rename double-click)
- **Agent chat**: can call tools automatically; tool calls always appear in Intel and also route to their target windows when possible
- **News**: auto-loads on open (default query `"polymarket"`). Powered by `gdelt_news` (free; rate-limited; longer queries work better). `/api/news` exists for legacy/direct reads.
- **Tape / Feed**: live Polymarket trades (polls `/api/polymarket/feed`).
- **Order Book**: `WIN` → `Launch` (each launch creates a new book window) or `/exec book BTC/USDT binance`
- **Debug**: add `?debug=1` to the URL to log UI init events to the console.

## Tools (Agent-Callable)

### Current Tools
| Tool | Description | Cost |
|------|-------------|------|
| `grok_search` | X/Twitter + web + news via xAI | Paid |
| `gdelt_news` | Free news headlines | Free |
| `polymarket_trades` | Trade tape via Data API | Free |
| `polymarket_book` | Order book via Gamma + CLOB | Free |
| `coingecko_price` | Crypto spot prices | Free |
| `nasdaq_quote` | US stock quote (delayed) via Nasdaq | Free |
| `nasdaq_candles` | US stock candles via Nasdaq | Free |

### Planned Tools (Priority Order)
| Tool | Description | Status |
|------|-------------|--------|
| `yahoo_finance` | Stock quotes + fundamentals (market cap, P/E) | Tier 1 |
| `arxiv_search` | Academic paper search | Tier 1 |
| `fred_economic` | Fed funds, CPI, unemployment | Tier 1 (needs API key) |
| `deribit_options` | BTC/ETH Greeks (delta, gamma, IV) | Tier 2 |
| `alpha_vantage_quote` | Backup stock source | Tier 2 |
| `economic_calendar` | FOMC, earnings dates | Tier 3 |

### Data Source Status
| Source | Freshness | Notes |
|--------|-----------|-------|
| Polymarket APIs | Real-time | Trades, books, metadata |
| CoinGecko | Real-time | Crypto prices |
| Nasdaq | ~15min delay | Stocks (quote, candles) |
| GDELT | Hours | Free news |
| Grok | Real-time | X/Twitter, web (paid) |
| arXiv | 1-2 days | Academic papers |
| FRED | Daily | Economic data (free key needed) |
| Reddit | ❌ Blocked | Use Grok/web search |

## Key Files

```
web/                     # UI (HTML/CSS/JS)
src/ui/server.ts         # UI server + API endpoints
src/core/                # Command surface + parsing
src/integrations/        # Source integrations (edgar, grok)
src/tools/               # Provider-agnostic tool wrappers (+ registry)
my_workspace/skills/     # One SKILL.md per tool (for agent retrieval)
my_workspace/TOOL_SKILLS_INDEX.md  # Index of tool skill docs

src/agents/
├── agentic-research.ts  # Opus 4.5 + thinking + tools (main agent)
├── grok.ts              # Twitter/web/news via xAI
├── gemini.ts            # Bulk text processing
├── scratchpad.ts        # Per-market memory

src/manipulation/
├── stream.ts            # Trade collector
├── enrich.ts            # Wallet + market enrichment
├── detect.ts            # Detection queries
├── db.ts                # SQLite persistence

data/
├── truth-terminal.db    # Research cases
├── manipulation.db      # Trades, wallets, alerts
├── cases/               # Research case JSON
├── transcripts/         # Full agent conversation logs
```

## API Endpoints

```bash
# UI server
curl -sS http://127.0.0.1:7777/api/health
curl -sS -X POST http://127.0.0.1:7777/api/exec -H 'Content-Type: application/json' -d '{"line":"help"}'
curl -sS http://127.0.0.1:7777/api/news?q=tesla
curl -sS "http://127.0.0.1:7777/api/polymarket/feed?limit=50"

# Tool registry (for any agent harness)
curl -sS http://127.0.0.1:7777/api/tools
curl -sS -X POST http://127.0.0.1:7777/api/tools/execute -H 'Content-Type: application/json' -d '{"name":"coingecko_price","params":{"query":"BTC","vsCurrency":"usd"}}'
curl -sS -X POST http://127.0.0.1:7777/api/tools/execute -H 'Content-Type: application/json' -d '{"name":"nasdaq_quote","params":{"symbol":"AAPL"}}'

# Stocks (Nasdaq-backed)
curl -sS "http://127.0.0.1:7777/api/stocks/quote?symbol=AAPL"
curl -sS "http://127.0.0.1:7777/api/stocks/candles?symbol=AAPL&range=1d&interval=1m"

# Order book
curl -sS "http://127.0.0.1:7777/api/orderbook/binance/symbols"

# Polymarket APIs (external)
curl "https://data-api.polymarket.com/trades?limit=10"
curl "https://data-api.polymarket.com/trades?user=0x..."
curl "https://gamma-api.polymarket.com/markets?limit=10"
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

## Detection Thresholds

| Signal | Threshold |
|--------|-----------|
| Fresh wallet | < 14-30 days |
| Concentrated | ≤ 5 markets |
| Low odds | < 15% (suspicious), < 5% (very) |
| Large trade | > $1K (whale), > $100 (signal) |
| Win rate anomaly | > 80% over 10+ markets |

## Cost Model

| Source | Cost |
|--------|------|
| Claude Opus 4.5 (agentic) | ~$0.50-2.00 per case |
| Grok Live Search | ~$0.10-0.50 per case |
| Gemini 2.0 Flash | ~$0.001-0.01 |
| YouTube | Free |
| Polymarket APIs | Free |
| GDELT News | Free |

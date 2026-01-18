# TODO - Roadmap

## Vision: Prediction Research Workstation

Truth Terminal is a **timing arbitrage system** for Polymarket. The edge isn't speed - it's knowing *when* to enter based on information arrival timing and disciplined execution via precommitted rules.

---

## Priority 0: Data Tools (Sticky Vision)

**Get the data flowing first.** Each integration is a `Tool` (JSONSchema params → structured data out) callable by any LLM harness.

The goal: **versatile, low-latency data retrieval** from maximum sources. Same pipeline feeds both UI and agent. Simple, flexible tools that let the agent search freely.

### UI Audit Fixes (Jan 2026)
- [x] News window auto-loads on open (default query `"polymarket"`)
- [x] Tape / Feed window wired to live Polymarket trades (`/api/polymarket/feed`)
- [ ] Re-test “weird query” error UX (confirm raw JSON never leaks to UI)

### Current Tools (Shipped)
- [x] Tool registry + interface (`src/tools/`)
- [x] Tool discovery/execution endpoints: `GET /api/tools`, `POST /api/tools/execute`
- [x] Agent chat tool-calling (Anthropic tools) via `POST /api/chat`
- [x] `grok_search` - X/Twitter + web + news via xAI (paid, best for social sentiment)
- [x] `gdelt_news` - Free headlines, good for background news
- [x] `polymarket_trades` - Real-time trade tape via Data API (free)
- [x] `polymarket_book` - Order book depth via Gamma + CLOB (free)
- [x] `coingecko_price` - Crypto spot prices (free, real-time)
- [x] `nasdaq_quote` - US stock quote (delayed) via Nasdaq (free)
- [x] `nasdaq_candles` - US stock candles via Nasdaq (free)
- [x] GDELT hardening: shared cache + timeouts + global rate limit gate

### Data Sources Assessment (Jan 17, 2026)

| Source | Status | Freshness | Notes |
|--------|--------|-----------|-------|
| Polymarket Data API | ✅ Working | Real-time | Trades from seconds ago |
| Polymarket Gamma API | ✅ Working | Real-time | Market metadata, volume, liquidity |
| CoinGecko | ✅ Working | Real-time | BTC/ETH/altcoins |
| Nasdaq | ✅ Working | ~15min delay | Stocks (quotes, candles) |
| GDELT | ✅ Working | Hours | Free news, good for background |
| arXiv | ✅ Working | 1-2 days | Academic papers |
| Semantic Scholar | ✅ Working | Weeks | Research with citations |
| Anthropic Web Search | ✅ Working | Real-time | Best for current events |
| FRED | ⚠️ Needs API key | Daily | Economic indicators (free key) |
| Alpha Vantage | ⚠️ Needs API key | Real-time | Stock backup (free key) |
| Reddit | ❌ Blocked | - | Use Grok/web search instead |
| X/Twitter direct | ❌ Needs auth | - | Use Grok search |

### Next Tools (Prioritized)

**Tier 1 - Add This Week (Free, High Value)**
- [ ] `yahoo_finance` - Stock quotes + fundamentals (market cap, P/E, 52w range, volume)
- [ ] `yahoo_finance_candles` - OHLCV historical data with intervals
- [ ] `arxiv_search` - Academic paper search (already works, just wrap it)
- [ ] `fred_economic` - Fed funds rate, CPI, unemployment, GDP (free API key required)

**Tier 2 - Add Next (Free/Cheap, Fills Gaps)**
- [ ] `alpha_vantage_quote` - Backup stock source when Yahoo rate-limits
- [ ] `deribit_options` - BTC/ETH options Greeks (delta, gamma, theta, vega, IV)
- [ ] `semantic_scholar` - Academic research with citation counts
- [ ] `polywhaler_alerts` - Whale activity tracker (scrape polywhaler.com)

**Tier 3 - Add Later (Specialized)**
- [ ] `economic_calendar` - Scheduled events (earnings, FOMC, elections) via FMP or Investing.com
- [ ] `tradingview_ta` - Technical analysis indicators (RSI, MACD, etc.)
- [ ] `santiment_social` - Crypto social sentiment (paid)
- [ ] `lunarcrush_social` - Crypto social metrics (paid)

**Tier 4 - Future (When Needed)**
- [ ] `binance_futures` - Crypto futures data + funding rates
- [ ] `cboe_options` - Stock options data (delayed)
- [ ] `google_trends_proxy` - Search interest via pytrends or web search

### Provider Hardening
- [ ] Rate limiting with exponential backoff for all external APIs
- [ ] Retry logic (3 attempts with jitter)
- [ ] Provider fallbacks (Nasdaq → Yahoo → Alpha Vantage for quotes)
- [ ] Request caching (5min for quotes, 1hr for fundamentals)
- [ ] Cost caps for paid APIs (Grok: $X/day limit)
- [ ] Health checks surfaced in UI (which providers are up/down)

### Infrastructure
- [ ] Window routing: tool outputs land in target windows (not just Intel)
- [ ] Server→UI streaming (SSE/WebSocket) for real-time tool feeds
- [ ] Tool output citations: clickable sources that focus source window

---

## Priority 1: Watchlist + Conviction Tracker

**The core of the research workflow.**

- [x] Design conviction schema:
  ```
  marketId, question, myProbability, marketProbability, edge,
  keyUncertainties[], entryThesis, exitConditions[], status (watching|entered|exited)
  ```
- [x] SQLite table for convictions (watchlist)
- [x] UI: Watchlist window showing all watched markets with edge calculation
- [ ] UI: Conviction editor (add/edit thesis, probabilities, uncertainties)
- [x] API: CRUD endpoints for convictions
- [ ] Link research cases to convictions (case informs thesis)
- [ ] Real-time edge update as market prices change

---

## Priority 2: Polymarket Order Book Window

**Liquidity assessment before entry.**

- [x] Polymarket CLOB API integration (order book depth)
- [x] UI: Order book window (v1: live depth + slippage)
  ```
  ┌─────────────────────────────────────────────────────────┐
  │  POLYMARKET BOOK    [Contract ▼]              ● LIVE   │
  ├─────────────────────────────────────────────────────────┤
  │   YES ASKS                                              │
  │   ████████████████████  68.5¢   $2,341                 │
  │   ██████████████        67.0¢   $1,203                 │
  │                                                         │
  │   ───────  SPREAD: 1.5¢  │  MID: 65.75¢  ───────       │
  │                                                         │
  │   YES BIDS                                              │
  │   ██████████████        65.0¢   $1,102                 │
  │   ████████████████████  64.0¢   $2,450                 │
  │                                                         │
  ├─────────────────────────────────────────────────────────┤
  │  24h vol: $45K  │  liquidity: $12K  │  exp: Dec 31     │
  │  YOUR POSITION: 150 YES @ 58.2¢  │  P&L: +$10.65      │
  └─────────────────────────────────────────────────────────┘
  ```
- [x] Contract selector (search watched markets)
- [x] Position display (from portfolio)
- [x] Slippage calculator (how much size can I enter?)

---

## Priority 3: Information Calendar

**When will data arrive that moves the market?**

- [x] Event schema (v1): `marketId?`, `title`, `date`, `dateConfidence`, `source?`, `impactHypothesis`, `createdBy`
- [ ] Event types: scheduled (earnings, elections, court), historical patterns, news triggers
- [x] UI: Calendar window (v1: manual event entry + per-market filtering)
- [ ] News alerts: filter GDELT/Grok to watched markets, surface relevant hits
- [ ] Historical pattern analysis: how did similar contracts move pre-event?

---

## Priority 4: Entry Rule Engine

**Precommitted rules to remove emotion.**

- [x] Rule schema (v1):
  ```
  marketId, type (price_below|price_above), priceThreshold,
  minMyProbability? , status (active|triggered|disabled)
  ```
- [x] Rule evaluation: check conditions against live prices (v1: price-only)
- [x] UI: Rule builder per market
- [x] Alerts when rules trigger (in-app)
- [ ] Audit log: what rules triggered, when, what action taken

---

## Priority 5: Portfolio Dashboard

**Aggregate view across all positions.**

- [x] Position tracking schema (v1): `marketId, outcome (YES|NO), shares, avgPrice` (+ derived currentPrice/value/pnl on read)
- [x] Manual position entry (until trade execution wired)
- [x] UI: Portfolio window (v1 totals + per-position P&L)
- [ ] Correlation analysis (are bets concentrated on same theme?)
- [ ] Time-to-resolution distribution
- [ ] Aggregate expected value
- [ ] Export to CSV for external analysis

---

## Infrastructure: Agent Upgrade

**Make the agent actually useful.**

- [x] Tool registry: structured schema for all available tools (v1: `src/tools/`, `GET /api/tools`)
- [x] Auto tool selection: agent chooses tools based on task (v1: tool-calling in `POST /api/chat`)
- [ ] Window targeting: tool outputs route to correct window
- [ ] Citations as first-class: clickable sources that focus source window
- [ ] Durable memory: persist chat history + context per workspace
- [ ] Agent can orchestrate: "show me the order book for X" → focuses BOOK window with X loaded

---

## Infrastructure: Event Bus

**Unified streaming from server to UI.**

- [ ] Server-sent events or WebSocket for tool outputs
- [ ] Event schema: `{ type, targetWindow, payload, timestamp }`
- [ ] UI subscribes to events, routes to correct window
- [ ] Backpressure handling for high-frequency updates

---

## Infrastructure: Provider Hardening

**Don't break when APIs hiccup.**

- [ ] Rate limiting with backoff for all external APIs
- [ ] Retry logic with exponential backoff
- [ ] Provider fallbacks (Nasdaq → Yahoo for quotes)
- [ ] Health checks surfaced in UI
- [ ] Auth/binding safeguards if ever exposed beyond localhost

---

## Manipulation Detection (Existing - Maintain)

- [ ] Keep stream running for ongoing data collection
- [ ] Topic clustering: group markets by entity
- [ ] Wallet cluster detection: find coordinated wallets
- [ ] Real-time alerts during collection
- [ ] Win rate tracking (needs resolution data)

---

## Technical Debt

- [ ] Fix `npm run build` (strict TS issues in old agent code)
- [ ] Add basic tests for critical paths (conviction CRUD, rule evaluation)
- [ ] Market title enrichment incomplete (some show as condition_id)
- [ ] Graceful shutdown for stream collector

---

## Future (Not Now)

- [ ] Trade execution: wire Polymarket CLOB API for real orders
- [ ] Calibration loop: track outcomes, build feedback into case ranking
- [ ] Additional prediction markets beyond Polymarket
- [ ] Financial market data (Alpha Vantage, Yahoo) for correlation
- [ ] Mobile alerts via Telegram/webhook

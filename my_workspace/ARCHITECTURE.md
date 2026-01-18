# Truth Terminal Architecture

## The Core Problem

Truth Terminal is a **prediction research workstation for timing arbitrage** on Polymarket.

The fundamental question it answers:

> "I believe X will happen, but the market prices in uncertainty about *when*. How do I time my entry to maximize returns?"

This is **not** HFT. The edge isn't speed - it's:
1. **Better prediction of when information will arrive**
2. **Better modeling of how the market will reprice as time passes**
3. **Disciplined execution via precommitted rules**

---

## The Sticky Vision (Development Pivot)

Truth Terminal is a **real-time information cockpit** where an agent (you + LLM) can pull any data source on demand and act on it.

The UI/conviction tracking/rules are refinements that come **after** the data is accessible and queryable in real-time.

**The development unit is a tool:**
- takes a query
- returns structured data
- can be called by any LLM harness

**Two parallel tracks:**
1. **UI + Visibility** - Bloomberg-vibes dashboard with controllable windows
2. **Data Latency** - Getting the most up-to-date data from maximum sources

Same API pipeline feeds both UI and agent. The agent needs simple, flexible tools to search freely across all channels.

---

## Data Sources Strategy

### The Goal

Versatile, low-latency data retrieval. The conviction tracker needs to support:
- **Market data**: prices, volume, order book depth, slippage
- **Fundamentals**: market cap, P/E, Greeks (delta, gamma, theta, vega)
- **Sentiment**: social (X, Reddit), news, analyst views
- **Events**: economic calendar, earnings, scheduled announcements
- **Research**: academic papers, reports, deep dives

For Polymarket-specific markets (crypto, politics, sports), we build custom pipelines.
For traditional markets (stocks), we leverage existing APIs (Yahoo, TradingView embeds).

### Current Data Sources

| Category | Source | Status | Freshness | Cost |
|----------|--------|--------|-----------|------|
| **Prediction Markets** | Polymarket Data API | ✅ Live | Real-time | Free |
| | Polymarket Gamma API | ✅ Live | Real-time | Free |
| | Polymarket CLOB | ✅ Live | Real-time | Free |
| **Crypto** | CoinGecko | ✅ Live | Real-time | Free |
| | Binance (symbols) | ✅ Live | Real-time | Free |
| **Stocks** | Nasdaq (via server) | ✅ Live | ~15min delay | Free |
| | Yahoo Finance | ✅ Tested | ~15min delay | Free |
| **News** | GDELT | ✅ Live | Hours | Free |
| | Anthropic Web Search | ✅ Live | Real-time | Included |
| **Social** | Grok (X/Twitter) | ✅ Live | Real-time | Paid |
| **Academic** | arXiv | ✅ Tested | 1-2 days | Free |
| | Semantic Scholar | ✅ Tested | Weeks | Free |
| **Economic** | FRED | ⚠️ Needs key | Daily | Free |
| **Options** | Deribit (crypto) | 🔜 Planned | Real-time | Free |

### Planned Integrations (Priority Order)

**Tier 1 - High Value, Free**
- Yahoo Finance fundamentals (market cap, P/E, 52w range)
- arXiv paper search (wrap existing)
- FRED economic indicators (CPI, fed funds, unemployment)

**Tier 2 - Fills Critical Gaps**
- Deribit options Greeks (BTC/ETH delta, gamma, IV)
- Alpha Vantage (backup stock source)
- Polywhaler (whale activity scraping)

**Tier 3 - Specialized**
- Economic calendar (FOMC dates, earnings)
- TradingView technical indicators
- Santiment/LunarCrush social sentiment

### What's Blocked

| Source | Issue | Workaround |
|--------|-------|------------|
| Reddit API | Blocked by fetch | Use Grok or web search |
| X/Twitter direct | Requires auth | Use Grok search |
| Google Trends | No direct API | Web search proxy |

### Provider Reliability

Current gaps to close:
- **Rate limiting**: Nasdaq public API can rate-limit; need fallbacks
- **Retries**: No exponential backoff yet
- **Caching**: Only GDELT has shared cache
- **Cost caps**: Grok can get expensive; no limits in place

### The Timing Problem

Polymarket contracts price in:
- **Probability of outcome** — will X happen?
- **Time decay** — how long until resolution?
- **Information arrival** — when will we *know* more?

Example: Contract "Will [Country] hold elections before July 2025?"
- You believe: 85% likely
- Market says: 60%
- Resolution: months away

**The problem:** Buy now at 60¢ and your capital is locked. Meanwhile:
- New information could let you buy cheaper later
- Opportunity cost on other bets
- Market might reprice slowly even if you're right

**What you need:** A system that helps decide *when* to enter, not just *what* to bet on.

---

## Product Vision: Five Core Capabilities

### 1. Conviction Tracker (Watchlist)
Structured theses with explicit beliefs:
```
Contract: "X wins election"
My probability: 72%
Market probability: 58%
Edge: +14 points

Key uncertainties:
- Polling data (next release: March 15)
- Candidate health (unknown)

Entry thesis: Wait for post-March-15 if polls confirm, or buy now if market dips below 50¢
```

### 2. Information Calendar
When will new information arrive that could move this market?
- Scheduled events (earnings, elections, court dates, policy announcements)
- Historical patterns (how did similar contracts move over time?)
- News monitoring (alert when relevant news hits for watched contracts)

### 3. Entry/Exit Signal Framework (Rule Engine)
Precommitted decision rules:
```
IF market price < 50¢ AND my conviction > 70% THEN buy
IF market price > my conviction THEN sell (or don't enter)
IF key uncertainty resolves unfavorably THEN exit
IF time to expiration < 30 days AND no edge THEN exit
```

### 4. Portfolio Dashboard
Aggregate view across positions:
- Total capital deployed vs available
- Correlation between bets (concentration risk)
- Time-to-resolution distribution
- Expected value calculation across portfolio

### 5. Order Book for Liquidity Assessment
Not for speed - for execution quality:
- **Liquidity:** Can I get filled at this price, or will I move the market?
- **Spread cost:** What's the real transaction cost?
- **Whale watching:** Are large players entering/exiting?
- **Depth:** Can I size up without slippage?

---

## Current State

### UI Layer
**Purpose:** Bloomberg-vibes local UI (windows, workspaces, agent chat, news, tool traces).

**Location:**
- UI server: `src/ui/server.ts`
- Web UI: `web/`
- Optional CLI REPL: `src/ui/terminal.ts`

**Flow:**
```
Browser UI (web/) → local HTTP server → core commands + tool registry → tool outputs/events → UI windows
```

**Key endpoints:**
- `POST /api/exec` - execute a command
- `POST /api/chat` - agent chat + tool events
- `GET /api/news` - GDELT headlines
- `GET /api/tools` - tool registry (LLM-callable)
- `POST /api/tools/execute` - execute a tool by name (non-chat harnesses)
- `GET /api/stocks/quote` - US stock quote (Nasdaq-backed)
- `GET /api/stocks/candles` - candle series (Nasdaq-backed)
- `GET /api/orderbook/binance/symbols` - Binance symbol universe
- `GET /api/orderbook/polymarket/book` - Polymarket CLOB book (YES/NO)
- `GET /api/polymarket/feed` - Polymarket live trade feed

**UI concepts:**
- **Working windows**: topbar center shows only windows open in the current workspace
- **Windows**: draggable/resizable, focus highlights border, `WIN` is a launcher (use `Launch` to open/focus; some kinds can be multi-instance)
- **Workspaces**: Excel-style tabs with per-workspace state persistence

### What Works Today
- **Window shell**: drag/resize, focus model, WIN menu, workspace tabs all solid
- **Agent chat can call tools**: tool registry + Anthropic tool-calling emits tool events
- **Decision workflow v1**: watchlist (convictions), calendar (events), rules (alerts), portfolio (manual positions) persisted in SQLite
- **Research agent**: Opus 4.5 with extended thinking + tools produces real cases
- **Manipulation detection**: Caught real insider ($350K Venezuela bet)
- **Data sources**: Grok, GDELT, Polymarket Data API/CLOB, CoinGecko, Nasdaq, YouTube, Gemini

### What's Scaffolded But Limited
- **Window targeting is partial**: tool results render in Intel; limited window-specific routing
- **Tool coverage is still thin**: only a handful of sources wrapped so far
- **No durable memory**: chat/context persistence is shallow
- **Data providers fragile**: Nasdaq public API can rate-limit, TradingView embed is external
- **EXEC is simulation**: local only, no real broker/exchange connection
- **Workflow is v1**: conviction editor/case linking + real-time updates still missing

### Architectural Gaps to Close
1. **Tool-driven agent**: registry + auto tool calls (done); window-targeted output + citations still needed
2. **Unified event bus**: server → UI streaming so tools push to correct window
3. **Hardened providers**: rate limiting, retries, fallbacks
4. **Conviction/portfolio persistence**: structured storage for theses and positions

---

## Existing Subsystems

### Tool Registry (`src/tools/`)
Provider-agnostic wrappers (JSONSchema params → structured data). Exposed via `GET /api/tools` and used by agent tool-calling in `POST /api/chat`.

Tool docs live as one file per tool in `my_workspace/skills/` (index: `my_workspace/TOOL_SKILLS_INDEX.md`).

### Research Agent (`src/agents/`)
Produces structured cases for markets.

**Components:**
- `agentic-research.ts` - Opus 4.5 with extended thinking + tools
- `grok.ts` - Twitter/X + web + news via xAI
- `gemini.ts` - Bulk text processing (cheap, 1M context)
- `youtube.ts` - Video transcript extraction
- `scratchpad.ts` - Per-market memory

**Output:** `data/cases/`, `data/transcripts/`

**Commands:**
```bash
npm run phase0:list            # List top markets
npm run research:agentic <id>  # Full Opus research
```

### Manipulation Detection (`src/manipulation/`)
Detects insider trading patterns from trade flow.

**Components:**
- `stream.ts` - Trade collector (polls every 10s)
- `db.ts` - SQLite: trades, wallet_profiles, market_meta, alerts
- `enrich.ts` - Fetch wallet history + market titles
- `detect.ts` - Run detection queries

**Output:** `data/manipulation.db`

**Commands:**
```bash
npm run stream           # Collect (runs forever)
npm run stream:enrich    # Enrich wallets + markets
npm run stream:detect    # Run detection report
```

## Databases

### `data/truth-terminal.db`
Research cases, decisions, trades (for the research system).

### `data/manipulation.db`
Trades, wallet profiles, market metadata, alerts (for manipulation detection).

---

## API Keys Required

```
ANTHROPIC_API_KEY=sk-ant-...   # Claude
GROK_API_KEY=xai-...           # Grok/xAI (or XAI_API_KEY)
GEMINI_API_KEY=AIza...         # Gemini (optional)
POLYMARKET_API_KEY=...         # Trading (not implemented yet)
```

---

## Cost Model

**Research:**
- Claude Opus 4.5 (agentic): ~$0.50-2.00 per case
- Grok Live Search: ~$0.10-0.50 per case
- Gemini: ~$0.001-0.01 (very cheap)

**Manipulation Detection:**
- Data API: Free
- Gamma API: Free
- No AI costs (pure data collection + SQL queries)

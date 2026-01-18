# Session Log - Jan 18, 2026 (UI Audit Fixes: News + Tape + Errors)

## Orchestration Model

New workflow for UI development using multi-agent collaboration:

| Role | Responsibility |
|------|----------------|
| **Mani** | Vision, final decisions, UX taste |
| **Opus** | Architecture, orchestration, prompt engineering |
| **Codex 5.2** | Implementation (TypeScript, CSS, DOM) |
| **Haiku (browser)** | Automated UI testing + visual QA |

**Flow:**
1. Opus writes spec/prompt based on requirements
2. Mani passes prompt to Codex for implementation
3. Haiku tests in browser and reports back
4. Review findings, iterate

This session validated the loop: Haiku caught stale cache issue, Codex fixed it, Haiku re-verified.

## What Shipped

- **News window** now auto-loads headlines on open using default query `"polymarket"` (no manual input needed).
- **Tape / Feed window** now shows live Polymarket trades (polls `/api/polymarket/feed` ~every 3s), with BUY green / SELL red.
- **Error UX** improved across UI fetch paths: server JSON errors are parsed into user-friendly messages (still needs focused re-test on "weird queries").

## Files Touched

- UI: `web/app.js`, `web/index.html`, `web/styles.css`
- UI server: `src/ui/server.ts` (serve correct `web/` when running from `dist/`)

## Quick Verify

```bash
curl -sS http://127.0.0.1:7777/api/health
curl -sS "http://127.0.0.1:7777/api/polymarket/feed?limit=3"
```

Browser:
- Load `http://127.0.0.1:7777` → News should populate immediately.
- Tape should fill with trades and keep updating.
- Optional debug logs: `http://127.0.0.1:7777/?debug=1` (console shows `[tt] ...` init events).

---

# Session Log - Jan 17, 2026 (Code Review + Data Pipeline)

## What Got Built

**New Tools:**
- `nasdaq_quote` - US stock quotes via Nasdaq (delayed, free)
- `nasdaq_candles` - OHLCV candles via Nasdaq (1d/5d/1mo ranges)

**New Provider:**
- `src/tools/providers/nasdaq.ts` - Caching (3s quotes, 5s candles), timeout handling, OHLCV bucketing

**Skill Docs (Agent-Retrievable):**
- `my_workspace/skills/tool-*/SKILL.md` for all 7 tools
- Index at `my_workspace/TOOL_SKILLS_INDEX.md`
- Each doc: when to use, parameters, examples, output format, targetWindow

## Architecture Pattern (Good)

```
Tool (src/tools/*.ts)
  → calls Provider (src/tools/providers/*.ts)
  → Provider handles: caching, timeouts, parsing
  → Tool handles: validation, rendering, targetWindow
```

This separation is clean. New tools follow the pattern.

## Skill Docs Pattern (Good)

Each skill doc is self-contained with:
- YAML frontmatter (name, description)
- "When to use" / "Don't use" guidance
- Parameter schema with examples
- Output format description
- `targetWindow` hint for UI routing

Agent can load index → pick tools → load specific skill docs. Modular context.

---

## Data Pipeline Assessment

Comprehensive test of all data retrieval capabilities - freshness, accuracy, reliability.

### Test Results Summary

**Working Well (Real-time, Reliable)**
| Source | Freshness | Test Result |
|--------|-----------|-------------|
| Polymarket Data API | Real-time | ✅ Trades from seconds ago |
| Polymarket Gamma API | Real-time | ✅ Top markets by volume |
| CoinGecko | Real-time | ✅ BTC $94,970, ETH $3,301 |
| Yahoo Finance | ~15min delay | ✅ AAPL $255.53, good candles |
| GDELT | Hours | ✅ Polymarket news from Dec 2025 |
| arXiv | 1-2 days | ✅ Papers from Jan 15, 2026 |
| Semantic Scholar | Weeks | ✅ Research with citations |
| Anthropic Web Search | Real-time | ✅ Current events, analyst views |

**Needs API Key (Free tier available)**
- FRED: Economic indicators (fed funds, CPI) - get key at fred.stlouisfed.org
- Alpha Vantage: Stock backup - get key at alphavantage.co

**Blocked/Problematic**
- Reddit API: Blocked by WebFetch → use Grok or web search
- X/Twitter direct: Requires auth → use Grok search
- Polymarket CLOB direct: 400 error → use Gamma API wrapper

### Key Findings

1. **Anthropic web search is very powerful** for current events and analyst sentiment
2. **Grok covers social** (X/Twitter) well - no need for direct Twitter API
3. **Options Greeks are missing** - need Deribit API for crypto, TradingView for stocks
4. **Economic data is missing** - FRED key required for fed funds, CPI, etc.

### Documented in Reference Docs

Updated with comprehensive data pipeline vision:
- `TODO.md`: Tiered tool roadmap (Tier 1-4), provider hardening checklist
- `ARCHITECTURE.md`: Data sources strategy, current vs planned, what's blocked
- `QUICK_REFERENCE.md`: Tools tables (current + planned), data source status

### Next Steps

When we resume:
1. Get FRED API key (free) → add `fred_economic` tool
2. Wrap Yahoo Finance → add `yahoo_finance` tool with fundamentals
3. Wrap arXiv → add `arxiv_search` tool
4. Add Deribit → `deribit_options` for crypto Greeks

---

# Session Log - Jan 15, 2026 (Sticky Vision: Data Cockpit Pivot)

## The Sticky Vision

Truth Terminal is a **real-time information cockpit** where an agent (you + LLM) can pull any data source on demand and act on it.

The UI/conviction tracking/rules are refinements **after** the data is queryable in real-time.

## What We Implemented

- **Tool interface + registry:** `src/tools/` with `GET /api/tools` + `POST /api/tools/execute`
- **Agent tool-calling:** `POST /api/chat` can call tools automatically (Anthropic tools), still supports `/exec …`
- **Initial tools shipped:**
  - `grok_search` (X/web/news via xAI)
  - `gdelt_news` (free headlines)
  - `polymarket_trades` (Data API trade tape)
  - `polymarket_book` (Gamma + CLOB order book)
  - `coingecko_price` (crypto spot quotes)

## What’s Still Limited

- **Window targeting is partial:** tool results render in **Intel**; only some tools can trigger window behavior (e.g. order book open).
- **No durable memory / event bus yet:** chat history persistence and server→UI streaming are still roadmap items.

## Next (When We Resume)

1. Pick **3–5 sources** to prioritize next (Yahoo Finance, FRED, Reddit, Google Trends, Alpha Vantage).
2. Wrap each as a `Tool` (JSONSchema params → structured data out).
3. Add provider hardening: caching, retry/backoff, timeouts, cost caps (esp. Grok).
4. Improve window routing so tool outputs land in their target windows (not just Intel).

---

# Session Log - Jan 15, 2026 (Vision Alignment)

## What Changed

**Reframed the entire project direction.** Truth Terminal is no longer a "general-purpose query tool" - it's a **prediction research workstation for timing arbitrage** on Polymarket.

### The Core Insight

The edge isn't speed. It's:
1. Better prediction of when information will arrive
2. Better modeling of how the market will reprice as time passes
3. Disciplined execution via precommitted rules

### The Question We're Answering

> "I believe X will happen, but the market prices in uncertainty about *when*. How do I time my entry to maximize returns?"

### Five Core Capabilities (New Roadmap)

1. **Watchlist + Conviction Tracker** - Structured theses with your probability vs market, key uncertainties, entry/exit conditions
2. **Polymarket Order Book** - Liquidity assessment before entry (spread, depth, slippage)
3. **Information Calendar** - When will data arrive that moves watched markets?
4. **Entry Rule Engine** - Precommitted rules to remove emotion
5. **Portfolio Dashboard** - Aggregate view of positions, correlation, P&L

### What We Updated

- [ARCHITECTURE.md](ARCHITECTURE.md) - New vision section, reframed current state, identified gaps
- [TODO.md](TODO.md) - Complete rewrite with new priority order
- [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - Added vision summary, five capabilities

### Current State Assessment

**What works:**
- UI shell (windows, workspaces, persistence)
- Research agent (Opus 4.5 with thinking + tools)
- Manipulation detection (caught real insider)
- Tool registry + agent tool-calling (data flowing on-demand)
- Data sources (Grok, GDELT, Polymarket Data API/CLOB, CoinGecko, Nasdaq)

**What's scaffolded but limited:**
- Window targeting is partial (tool outputs still land in Intel; limited window routing)
- Durable memory is not implemented (chat + context persistence is shallow)
- EXEC is simulation only
- Workflow is v1 (conviction editor/case linking + real-time updates still missing)

**Gaps to close:**
- Tool-driven agent with window targeting (tool registry + tool-calling done; routing remains)
- Unified event bus (server → UI streaming)
- Hardened providers (rate limiting, retries, fallbacks)
- Conviction/portfolio persistence

---

## Clarifications (Q&A Log)

Captured decisions to reduce re-litigating fundamentals during implementation:

### Canonical Market IDs

- Use Polymarket `conditionId` as the canonical key for Polymarket-specific data.
- Add a thin mapping layer so we can support multiple sources later:
  - `Market.id` internal id
  - `Market.source` (`polymarket` | other)
  - `Market.externalId` = `conditionId` for Polymarket
  - Plus `slug`, `question`, `endDate`, `resolutionSource`

### “Market Probability” Definition

- Store/display all of: midpoint, best bid, best ask, last trade.
- Default “market probability” for edge calculations = **midpoint**.
- Use best ask for conservative entry cost, best bid for conservative exit value.

### Information Calendar (v1)

- v1: manual entry first (forces thesis discipline; ships fast).
- v1.5: agent suggests events (e.g. from GDELT) for watched markets; user approves/rejects.

Proposed v1 event fields:
- `marketId` nullable (null = global event)
- `title`, `date` (ISO or “unknown”), `dateConfidence` (exact/approximate/unknown)
- `source` (URL/descriptor), `impactHypothesis`
- `createdBy` (user/agent), `createdAt`

### Rule Engine Actions

- v1: **alerts only**.
- v2: optional simulated orders / approval flow, then execution automation later.

### Portfolio Units

- Source of truth: **shares + avg price per share**.
- Derived views: notional, implied probability, current value, unrealized P&L (computed on read).

### Recommended Sequencing (Revision)

1. Watchlist + Conviction
2. Information Calendar
3. Polymarket Order Book
4. Portfolio Dashboard
5. Entry Rule Engine

# Session Log - Jan 14-15, 2026

## What We Built

### Bloomberg-vibes UI + Window System

**New UI server:** `src/ui/server.ts`

**New web UI:** `web/` (`index.html`, `styles.css`, `app.js`)

UI features added:
- Draggable + resizable windows
- Focus highlighting (active window border turns green)
- Close windows (`×`) to remove from “working windows”; use `WIN` → `Launch` to reopen (Order Book can be multi-instance)
- Excel-style workspace tabs at the bottom (add/switch/remove; rename via double-click)
- Per-workspace persisted UI state:
  - Window geometry + visibility + focused window
  - News query
  - Chat session id (separate per workspace)

### Agent Window Backbone (Chat)

**Agent UI:** “Agent” window (chat style).

**Backend:** `POST /api/chat`
- If `ANTHROPIC_API_KEY` is present and valid, it replies via Anthropic.
- If not (or if Anthropic errors), it returns a friendly fallback instead of 500.
- Supports **automatic tool-calling** plus `/exec <command>` to run tools and emit “tool events”.

Pinned prompt behavior:
- The pinned prompt is now **dynamic**: as you scroll, it shows the most recent user prompt that corresponds to the visible section of the conversation (clamped to 2 lines with ellipsis).

### Intel Window (Tool Trace Stub)

**Intel UI:** shows tool events (from agent tool calls and `/exec ...`).
- Clicking an intel item focuses its target window (currently `intel`; intended to expand to `news`/future `twitter` window).

### News Window (Free Headlines)

**News UI:** “News” window.

**Backend:** `GET /api/news?q=<query>&limit=<n>` using GDELT (free).
- Headlines prepend at the top with timestamp + source.
- Some very short queries are rejected by GDELT; `ai` is mapped to “artificial intelligence”.
- GDELT is rate-limited; UI uses caching + a global request gate to avoid 429s.

---

## Commands

```bash
npm run ui    # Web UI at http://127.0.0.1:7777
npm run tt    # CLI REPL (optional)
```

## Where to Look in Code

- UI server + APIs: `src/ui/server.ts`
- UI window manager + workspaces: `web/app.js`
- UI styling: `web/styles.css`
- UI layout/windows: `web/index.html`
- Command surface: `src/core/`
- Integrations: `src/integrations/` (EDGAR + Grok)

## Current Limitations / Gotchas

- SEC EDGAR calls can 403/rate-limit; `SEC_USER_AGENT` is required and you may need to slow down retries.
- News via GDELT is “good enough free” but not premium wires; query quality matters.
- Agent chat history is not persisted end-to-end yet; only per-workspace pinned prompt + session id are persisted.

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

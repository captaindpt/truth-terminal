# Truth Terminal Architecture

## Current Shape

Truth Terminal is evolving from a Polymarket research tool into a general-purpose terminal for querying many data sources and building a local “truth substrate”.

Today, that shows up as two major integrations (plus a shared storage + agents layer).

### UI Layer (New)
**Purpose:** Bloomberg-vibes local UI for interacting with Truth Terminal (windows, workspaces, agent chat, news, tool traces).

**Location:**
- UI server: `src/ui/server.ts`
- Web UI: `web/`
- Optional CLI REPL: `src/ui/terminal.ts`

**Flow:**
```
Browser UI (web/) → local HTTP server → core commands/integrations → JSON outputs/events → UI windows
```

**Key endpoints:**
- `POST /api/exec` - execute a command (same command surface as `tt` CLI)
- `POST /api/chat` - agent chat + `/exec ...` tool events
- `GET /api/news` - free news headlines via GDELT

**UI concepts:**
- **Windows**: draggable/resizable, focus highlights border, close/reopen via WIN menu
- **Workspaces**: Excel-style tabs; each workspace persists window layout + visibility and some per-window state

### 1. Prediction Market Research (Polymarket)
**Purpose:** Research prediction markets and produce structured cases for fast review.

**Location:** `src/agents/`, `src/polymarket/`

**Flow:**
```
Polymarket API → Market Selection → Research Agents → Structured Cases → Mani Reviews
```

**Components:**
- `agentic-research.ts` - Opus 4.5 with extended thinking + tools
- `grok.ts` - Twitter/X + web + news via xAI
- `gemini.ts` - Bulk text processing (cheap, 1M context)
- `youtube.ts` - Video transcript extraction
- `scratchpad.ts` - Per-market memory

**Output:** `data/cases/`, `data/transcripts/`

**Commands:**
```bash
npm run phase0:list        # List top markets
npm run research:agentic <id>  # Full Opus research
```

---

### 2. Manipulation Detection (Polymarket)
**Purpose:** Detect insider trading and market manipulation patterns from trade flow.

**Location:** `src/manipulation/`

**Flow:**
```
Data API Polling → SQLite → Enrichment → Detection Queries → Alerts
```

**Components:**
- `stream.ts` - Trade collector (polls every 10s)
- `db.ts` - SQLite tables: trades, wallet_profiles, market_meta, alerts
- `enrich.ts` - Fetch wallet history + market titles
- `detect.ts` - Run detection queries
- `stats.ts` - Quick overview

**Output:** `data/manipulation.db`

**Commands:**
```bash
npm run stream           # Collect (runs forever)
npm run stream:enrich    # Enrich wallets + markets
npm run stream:detect    # Run detection report
npm run stream:stats     # Quick stats
```

---

## Next Architectural Move: A Unified “Query Tool”

The direction is to make adding new sources fast (web scrapes, financial market feeds, additional prediction markets, Mani’s separate Twitter tool, etc.) and expose them behind a consistent query surface.

Conceptually:
- **Integrations / connectors** fetch raw data (with caching + normalization)
- **Processors** enrich/cluster/detect patterns
- **Agents (optional)** synthesize into structured outputs
- **Stores** keep everything local + inspectable (SQLite + logs)

In practice, the UI now talks to a single “command surface” (the same idea as `npm run tt` / `POST /api/exec`). As we add new sources, they should plug into this surface so:
- the agent can request them,
- the UI can render their outputs/events,
- and “focus this window” becomes trivial (e.g., tool event targets `news`, `intel`, future `twitter` window).

## Databases

### `data/truth-terminal.db`
Research cases, decisions, trades (for the research system).

### `data/manipulation.db`
Trades, wallet profiles, market metadata, alerts (for manipulation detection).

---

## API Keys Required

```
ANTHROPIC_API_KEY=sk-ant-...   # Claude
GROK_API_KEY=xai-...           # Grok/xAI
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

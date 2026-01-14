# Truth Terminal Architecture

## Two Systems

### 1. Research System (Original)
**Purpose:** AI agents research Polymarket bets, build cases for Mani to review.

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

### 2. Manipulation Detection System (New)
**Purpose:** Detect insider trading and market manipulation.

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

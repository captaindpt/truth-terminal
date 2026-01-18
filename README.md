# Truth Terminal

Truth Terminal is a **prediction research workstation for timing arbitrage** on Polymarket.

## The Vision

The fundamental question it answers:

> “I believe X will happen, but the market prices in uncertainty about *when*. How do I time my entry to maximize returns?”

This is **not HFT**. The edge is:
- Better prediction of **when information arrives**
- Better modeling of **how repricing unfolds over time**
- Disciplined execution via **precommitted rules**

We’re building five core capabilities, in order:
1. **Watchlist + Conviction Tracker** (structured theses + edge vs market)
2. **Polymarket Order Book** (liquidity/spread/depth/slippage)
3. **Information Calendar** (when will new info arrive that moves watched markets?)
4. **Entry Rule Engine** (precommitted IF/THEN rules; alerts first)
5. **Portfolio Dashboard** (positions + P&L + concentration/time-to-resolution)

## Current Status

What works today:

- **Bloomberg-vibes local UI** with windows/workspaces/persistence (`web/`, `src/ui/server.ts`)
- **Tool registry + agent tool-calling** (agent can fetch live data sources on-demand; `GET /api/tools`)
- **Research agent** that can produce structured cases and transcripts (`src/agents/`, `data/cases/`, `data/transcripts/`)
- **Manipulation detection** (trade stream → enrichment → detection report) (`src/manipulation/`, `data/manipulation.db`)
- **Local SQLite** persistence for core subsystems (`data/*.db`)

What’s missing (roadmap work):
- Workflow refinements: conviction editor, case→conviction linking, real-time edge refresh, richer portfolio analytics
- Window-targeted outputs (tool routing) + more data tools
- Unified server→UI event streaming (event bus)
- Provider hardening (rate limits/retries/fallbacks)

## Quick Start

```bash
npm install
cp .env.example .env
# Add your API keys to .env:
#   ANTHROPIC_API_KEY=sk-ant-...
#   GROK_API_KEY=xai-...   # or XAI_API_KEY
```

### Commands

```bash
# UI (Bloomberg-vibes)
npm run ui
# open http://127.0.0.1:7777

# CLI (REPL)
npm run tt
npm run tt -- --eval "help"

# Test individual components
npm run test:grok "Russia Ukraine ceasefire"
npm run test:youtube <video-id>

# Research
npm run phase0:list              # List top markets
npm run phase0 516719            # Claude-only research
npm run research 516719          # Grok+Claude pipeline
npm run research:quick 516719    # Faster
npm run research:agentic 516719  # Tool-using agent (transcripts + scratchpad)

# Manipulation detection (Polymarket)
npm run stream
npm run stream:enrich
npm run stream:detect
npm run stream:stats
```

## Architecture

Truth Terminal is a local UI + a thin command surface + a set of subsystems:

- **UI layer:** `src/ui/server.ts` + `web/` (windows/workspaces; localhost-only)
- **Command surface:** `src/core/` (parsing + command registry used by `/api/exec` and CLI)
- **Research system:** `src/agents/`, `src/db/`, `data/truth-terminal.db`
- **Manipulation detection:** `src/manipulation/`, `data/manipulation.db`
- **Execution simulator (local):** `src/execution/`, `data/execution.db`

## Project Structure

```
src/
├── agents/
│   ├── claude.ts       # Claude SDK, basic research
│   ├── grok.ts         # Grok Live Search (X + web + news)
│   ├── youtube.ts      # YouTube transcript extraction
│   └── research.ts     # Multi-source research orchestrator
│   └── agentic-research.ts  # Tool-using agent (logs + scratchpad)
├── tools/               # Provider-agnostic tools (JSONSchema params → structured data)
├── polymarket/
│   └── client.ts       # Polymarket API client
├── manipulation/        # Polymarket manipulation detection
├── execution/           # Local execution simulator
├── ui/                  # UI server
├── core/                # Command parsing/registry
├── db/
│   └── index.ts        # SQLite for cases, decisions, trades
├── types/
│   └── market.ts       # Type definitions
├── phase0.ts           # Basic single-source research
├── test-grok.ts        # Grok integration test
├── test-youtube.ts     # YouTube transcript test
└── test-research.ts    # Full pipeline test

web/                     # UI (HTML/CSS/JS)
```

## Intel Sources

| Source | Status | Cost | What it provides |
|--------|--------|------|------------------|
| Polymarket APIs | ✅ | Free | Markets (Gamma), trades (Data API), order books (CLOB) |
| Grok Live Search | ✅ | $25/1k sources | Twitter/X + web + news |
| GDELT | ✅ | Free | News headlines |
| CoinGecko | ✅ | Free | Crypto spot prices/24h change |
| YouTube Transcripts | ✅ | Free | Video content analysis |
| Claude Sonnet | ✅ | API pricing | Analysis and synthesis |
| Nasdaq (delayed) | ✅ | Free | US stock quotes + candles |

## Research Case Output

Each research case includes:

```json
{
  "thesis": "Clear statement of position and reasoning",
  "edge": "What the market is missing",
  "recommendedPosition": "Yes/No/None",
  "confidence": "low/medium/high",
  "keyUncertainties": ["list", "of", "risks"],
  "whatWouldChangeAssessment": "Specific conditions",
  "sources": ["citations from Grok/web"],
  "twitterSignal": "bullish/bearish/neutral",
  "newsSignal": "bullish/bearish/neutral"
}
```

## Data Storage

- Research: `data/truth-terminal.db`, `data/cases/`, `data/transcripts/`, `data/scratchpads/`
- Manipulation: `data/manipulation.db`
- Execution (sim): `data/execution.db`

## Development Roadmap

- [x] UI shell (windows/workspaces) + local server
- [x] Research agent + cases/transcripts
- [x] Manipulation detection (stream/enrich/detect)
- [x] Watchlist + conviction tracker (v1: schema + CRUD + UI)
- [x] Polymarket order book window (v1: CLOB depth + slippage)
- [x] Information calendar (v1: events CRUD + UI)
- [x] Entry rule engine (v1: alerts-only)
- [x] Portfolio dashboard (v1: positions CRUD + P&L)
- [x] Agent upgrade (tool registry + tool-calling)
- [ ] Agent upgrade (window targeting, durable memory)
- [ ] Event bus (server→UI streaming) + provider hardening

## API Costs

Rough estimates per research case:
- Claude Sonnet: ~$0.02-0.05
- Grok Live Search: ~$0.10-0.50 (depends on sources)
- YouTube: Free
- Polymarket: Free

## Resources

- [Polymarket API Docs](https://docs.polymarket.com)
- [xAI/Grok API Docs](https://docs.x.ai)
- [Polymarket agents repo](https://github.com/Polymarket/agents)

# CLAUDE.md - Project Context for Future Sessions

Read `my_workspace/` first for the current vision and roadmap.

## What This Is

Truth Terminal is a **prediction research workstation for timing arbitrage** on Polymarket.

The fundamental question:

> “I believe X will happen, but the market prices in uncertainty about *when*. How do I time my entry to maximize returns?”

This is **not HFT**. The edge is: (1) information arrival timing, (2) repricing over time, (3) precommitted rules.

## Product Vision (Five Capabilities)

We are building these in order:
1. **Watchlist + Conviction Tracker**
2. **Polymarket Order Book** (CLOB depth + slippage)
3. **Information Calendar**
4. **Entry Rule Engine**
5. **Portfolio Dashboard**

Infra that supports this:
- Agent upgrade (tool registry, window targeting, durable memory)
- Event bus (server→UI streaming)
- Provider hardening (rate limiting/retries/fallbacks)

## Current State (Jan 2026)

### What Works
- **UI shell**: windows/workspaces/persistence in `web/`, served by `src/ui/server.ts`
- **Command surface**: `/api/exec` + CLI REPL (`src/core/`, `src/ui/terminal.ts`)
- **Tool registry + agent tool-calling**: `src/tools/`, `GET /api/tools`, agent chat can call tools via `POST /api/chat`
- **Workflow v1**: convictions (watchlist), events (calendar), rules (alerts), positions (portfolio) in SQLite via `src/db/`
- **Research agent**: structured case generation with transcripts/scratchpad (`src/agents/`, `data/cases/`, `data/transcripts/`, `data/scratchpads/`)
- **Manipulation detection**: trade stream + enrichment + detection report (`src/manipulation/`, `data/manipulation.db`)
- **Execution simulator** (local): orders/fills + slippage metrics (`src/execution/`, `data/execution.db`)

### What’s Missing (Roadmap Work)
- Workflow refinements: conviction editor, case→conviction linking, richer portfolio analytics, real-time edge refresh
- Window targeting is partial (tool outputs mostly render in Intel; limited window routing)
- More data tools (Yahoo Finance, FRED, Reddit, Google Trends, Alpha Vantage, etc.)
- Unified streaming/event bus (most UI is polling today)
- More robust provider layer (retries/backoff/fallbacks)

## Commands

```bash
# UI (Bloomberg-vibes)
npm run ui

# CLI (REPL)
npm run tt
npm run tt -- --eval "help"

# Research
npm run phase0:list
npm run research:agentic <id>

# Manipulation detection
npm run stream
npm run stream:enrich
npm run stream:detect
```

## Where To Look In Code

- Vision + roadmap: `my_workspace/ARCHITECTURE.md`, `my_workspace/TODO.md`, `my_workspace/SESSION_LOG.md`
- Tool docs (one per tool): `my_workspace/TOOL_SKILLS_INDEX.md`, `my_workspace/skills/`
- UI server + APIs: `src/ui/server.ts`
- Web UI (windows/workspaces): `web/app.js`, `web/index.html`, `web/styles.css`
- Command core: `src/core/`
- Tool registry + wrappers: `src/tools/`
- Research agent: `src/agents/agentic-research.ts`, `src/agents/scratchpad.ts`
- Manipulation system: `src/manipulation/stream.ts`, `src/manipulation/enrich.ts`, `src/manipulation/detect.ts`

## Architecture Notes

- Prefer **local-first**: SQLite + inspectable logs, localhost-only server.
- Keep **execution optional** until the decision workflow (convictions → rules → portfolio) is solid.

## Mani's Preferences

- He’s the final intuition layer; system proposes, he disposes.
- Wants to review fast; prefers structured outputs over long prose.
- Interested in “edge”: what the market isn’t pricing.
- Prefers Claude + Grok; uses Gemini for cheap bulk processing.

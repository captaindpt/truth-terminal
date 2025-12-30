# CLAUDE.md - Project Context for Future Sessions

## What This Is

Truth Terminal is a multi-agent prediction market research system. The user (Mani) sits at the top as the final decision-maker and capital allocator. The system automates the grunt work of building information substrates for judgment calls on Polymarket bets.

## The Vision (Mani's Words)

"I have a computer use Claude operating Polymarket. That Claude talks to other Claudes and gives them tasks - individual bets to research. Each research Claude does whatever it can - web search, thinking, getting info - and builds a case, a narrative, with reasoning. Then I review them fast, pick ones I have intuition on, and make bets with my money."

## Current State (As of Dec 30, 2024)

### What Works
- **Polymarket API** (`src/polymarket/client.ts`) - Fetches markets, prices, volume. Free tier.
- **Grok Live Search** (`src/agents/grok.ts`) - Twitter/X + web + news. $25/1k sources.
- **YouTube Transcripts** (`src/agents/youtube.ts`) - Extract video content. Free.
- **Claude Research** (`src/agents/claude.ts`) - Basic single-source analysis.
- **Multi-Source Pipeline** (`src/agents/research.ts`) - Orchestrates Grok + Claude into structured cases.
- **SQLite Persistence** (`src/db/index.ts`) - Cases, decisions, trades.

### Commands
```bash
npm run phase0:list              # List top markets
npm run phase0 <id>              # Claude-only research
npm run research <id>            # Full Grok+Claude pipeline
npm run research:quick <id>      # Same, faster
npm run test:grok "topic"        # Test Grok alone
npm run test:youtube <video-id>  # Test YouTube alone
```

### Key Files
- `src/agents/research.ts:100-150` - The `ENHANCED_RESEARCH_PROMPT`. This is where case quality is tuned.
- `src/agents/grok.ts` - Grok Live Search integration. Uses `/v1/chat/completions` with `search_parameters`.
- `src/polymarket/client.ts` - Gamma API at `https://gamma-api.polymarket.com/markets`.
- `src/db/index.ts` - SQLite schema for cases, decisions, trades, outcomes.

## What's Next (Roadmap)

### Phase 4: Review CLI/UI
Build an interface to scroll through cases fast. Approve/reject/ask for more. Current pain: reading JSON files manually.

### Phase 5: Trade Execution
Wire up Polymarket trading API. When Mani approves, place the order. The API supports full trading (order signing, submission). See `https://docs.polymarket.com` for CLOB API.

### Phase 6: Calibration Loop
Track outcomes. Which cases did Mani approve that won? Which did he override correctly? Build feedback loop into case ranking.

### Future Intel Sources
- **Alpha Vantage / Yahoo Finance** - Stock/crypto data for market-correlated bets.
- **LinkedIn** - Hostile territory, requires cookies, account bans after ~50 profiles. Skip for now.
- **Bloomberg Second Measure** - Credit card transaction data. Institutional pricing ($20k+/year). Not accessible yet.

## Architecture Decisions

### Why Grok for Twitter?
xAI's Live Search API gives Twitter access at $0.025/source vs X API at $200/month. 20-40x cheaper. Plus web + news in same call.

### Why Claude for Synthesis?
Grok gathers intel. Claude synthesizes into structured cases. Separation of concerns - Grok has data access, Claude has reasoning quality.

### Why SQLite?
Simple, local, inspectable. Cases are also saved as JSON in `data/cases/` for easy grep/review.

## Mani's Preferences

- He's the final intuition layer. System proposes, he disposes.
- Wants to review cases *fast* - not read 50 markdown files.
- Interested in "edge" - what is the market NOT pricing in?
- Skeptical of GPT, prefers Claude and Grok.
- Gemini is good for "slave labor" - bulk preprocessing, large context tasks.
- Based in Canada (Polymarket trading allowed).

## The Meta-Prompt Layer

Mani mentioned wanting a prompt injected between Polymarket fetch and research agent to guide case breakdown. This lives in `src/agents/research.ts` at `ENHANCED_RESEARCH_PROMPT`. Current prompt asks for:
- Thesis with reasoning
- Edge identification (what market is missing)
- Confidence calibration
- Risk factors
- What would flip the call

## API Keys Required

```
ANTHROPIC_API_KEY=sk-ant-...
GROK_API_KEY=xai-...        # Also accepts XAI_API_KEY
POLYMARKET_API_KEY=...      # Optional, only for trading
```

## Cost Estimates Per Research Case

- Claude Sonnet: ~$0.02-0.05
- Grok Live Search: ~$0.10-0.50 (depends on sources used)
- YouTube: Free
- Polymarket data: Free

## Known Issues / TODOs

1. Agentic search (grok-4-1-fast with tools) uses `/v1/responses` endpoint which needs different format. Currently using Live Search which works fine.
2. No review CLI yet - cases are just JSON files.
3. No trade execution wired up.
4. YouTube integration exists but not plugged into main pipeline by default.

## How to Continue

1. Run `npm run phase0:list` to see current markets.
2. Pick one, run `npm run research <id>` to test the pipeline.
3. Check `data/cases/` for output.
4. Iterate on `ENHANCED_RESEARCH_PROMPT` if cases are garbage.
5. Build Phase 4 (review CLI) when ready to scale.

---

*This project started Dec 29, 2024. See git log for history.*

# CLAUDE.md - Project Context for Future Sessions

read ./my_workspace to see what we been up to and where we're at

## What This Is

Truth Terminal is Mani’s terminal-first “truth stack”: a growing set of integrations that pull data from different sources (social, web research, markets, prediction markets, scrapers) and turn it into a local, queryable substrate for judgment and action.

Prediction markets (Polymarket) remain a core use case, but they are now just one source category among many.

## The Vision (Mani's Words)

"This is gonna be my terminal to find truth. I will query my tool and it will get me data from different sources. If I find a source that I can scrape I can make the integration real fast and go ahead."

The system should bias toward:
- Fast integrations (low friction to add new sources)
- Durable local storage (SQLite/logs you can inspect)
- High-signal synthesis (structured outputs you can review quickly)

## Current State (As of Dec 30, 2024)

### What Works
- **Prediction market ingestion** (`src/polymarket/client.ts`) - Fetches markets, prices, volume (Polymarket).
- **Social + web research** (`src/agents/grok.ts`) - Grok Live Search for X/Twitter + web + news.
- **YouTube ingestion** (`src/agents/youtube.ts`) - Extract video transcripts.
- **LLM synthesis** (`src/agents/research.ts`, `src/agents/agentic-research.ts`) - Structured cases + tool-using research.
- **Durable storage** (`src/db/index.ts`) - SQLite persistence for outputs.
- **Manipulation detection** (`src/manipulation/`) - Trade collection + enrichment + detection queries (Polymarket).

### Commands
```bash
# Prediction-market research
npm run phase0:list              # List top markets
npm run phase0 <id>              # Claude-only research
npm run research <id>            # Full Grok+Claude pipeline
npm run research:quick <id>      # Same, faster
npm run research:agentic <id>    # NEW: Opus 4.5 with thinking + tools
npm run test:grok "topic"        # Test Grok alone
npm run test:youtube <video-id>  # Test YouTube alone

# Manipulation detection (Polymarket)
npm run stream                   # Collect trades (background)
npm run stream:enrich            # Enrich wallets + markets
npm run stream:detect            # Run detection report
npm run stream:stats             # Quick overview
```

### Key Files
- `src/agents/agentic-research.ts` - **The main research agent.** Opus 4.5 with extended thinking, tool use, full transcript logging.
- `src/agents/gemini.ts` - Gemini tool for bulk text processing (summarize, extract facts, analyze).
- `src/agents/scratchpad.ts` - Per-market memory: facts, signals, uncertainties, hypotheses, notes.
- `src/agents/grok.ts` - Grok Live Search integration. Uses `/v1/chat/completions` with `search_parameters`.
- `src/polymarket/client.ts` - Gamma API at `https://gamma-api.polymarket.com/markets`.
- `src/db/index.ts` - SQLite schema for cases, decisions, trades, outcomes.

### Output Locations
- `data/cases/` - Final research cases as JSON
- `data/scratchpads/` - Per-market scratchpads (facts, signals, hypotheses)
- `data/transcripts/` - **Full agent conversation logs** (system prompt, thinking, tool calls, results)

## What's Next (Roadmap)

### Unify the “Query Tool”
Move toward a single interface for asking questions and pulling data from multiple sources (social/web, prediction markets, financial markets, custom scrapers). Existing components are “integrations”; the missing piece is a consistent query/response surface.

### Review UX (Terminal/CLI)
Make it easy to scan outputs quickly (cases, alerts, evidence) without reading raw JSON/logs.

### Add Integrations
- Financial markets data
- Additional prediction markets
- Scrapers for specific high-signal sites
- Reuse Mani’s separate Twitter tool where it’s better than Grok

### Optional: Execution + Feedback
Trade execution and calibration loops remain useful, but should be treated as optional integrations rather than the project identity.

## Architecture Decisions

### Why Grok for Twitter?
xAI's Live Search API gives Twitter access at $0.025/source vs X API at $200/month. 20-40x cheaper. Plus web + news in same call.

### Why Claude for Synthesis?
Grok gathers intel. Claude synthesizes into structured cases. Separation of concerns - Grok has data access, Claude has reasoning quality.

### Why Opus 4.5 with Extended Thinking?
The agentic research agent uses Opus 4.5 with extended thinking (10k token budget per turn). This gives the model space to reason deeply before acting. The full thinking is logged to transcripts so you can see the agent's reasoning process.

### Why Gemini for Bulk Processing?
Claude is expensive for large text. Gemini 2.0 Flash is cheap and has 1M context. The agent can offload grunt work (summarizing transcripts, extracting facts from long articles) to Gemini and keep the expensive Claude reasoning for synthesis.

### Why SQLite?
Simple, local, inspectable. Cases are also saved as JSON in `data/cases/` for easy grep/review.

## The Agentic Research System

The new `research:agentic` command runs a tool-using Claude Opus 4.5 agent that:

1. **Thinks** - Extended thinking mode lets it reason before acting
2. **Searches** - Uses Grok for Twitter/web/news intelligence
3. **Processes** - Can offload bulk text to Gemini
4. **Remembers** - Builds up facts/signals/hypotheses in a scratchpad
5. **Finalizes** - Produces a structured research case with thesis, edge, risks

### Agent Tools
- `grok_search` - Search Twitter, web, news
- `gemini_process` - Process large text with Gemini
- `youtube_transcript` - Fetch video transcripts
- `scratchpad_*` - Read/write facts, signals, uncertainties, notes
- `update_hypothesis` - Track YES/NO theses with evidence
- `finalize_research` - Commit to a recommendation

### Transcript Logging
Every agent run produces a full transcript in `data/transcripts/`. This shows:
- System prompt
- Market context
- Each turn with: thinking, speaking, tool calls, tool results
- Final recommendation

Read the transcript to understand how the agent reasoned through a market.

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
GEMINI_API_KEY=AIza...      # For bulk text processing
POLYMARKET_API_KEY=...      # Optional, only for trading
```

## Cost Estimates Per Research Case

- Claude Opus 4.5 (agentic): ~$0.50-2.00 (with extended thinking)
- Claude Sonnet: ~$0.02-0.05
- Grok Live Search: ~$0.10-0.50 (depends on sources used)
- Gemini 2.0 Flash: ~$0.001-0.01 (very cheap)
- YouTube: Free
- Polymarket data: Free

## Known Issues / TODOs

1. Grok web search sometimes times out - agent falls back to Twitter-only search which still works.
2. No review CLI yet - cases are just JSON files and transcripts.
3. No trade execution wired up.
4. YouTube integration exists but agent needs to be taught when to use it.
5. Enhanced research prompt needs iteration - teach agent how to decompose markets and what to look for.

## How to Continue

1. Run `npm run phase0:list` to see current markets.
2. Pick one, run `npm run research:agentic <id>` for full Opus+thinking research.
3. Check `data/transcripts/` for the full agent conversation log.
4. Check `data/cases/` for the final structured case.
5. Iterate on `AGENT_SYSTEM_PROMPT` in `agentic-research.ts` to improve agent behavior.
6. Build Phase 4 (review CLI) when ready to scale.

---

*This project started Dec 29, 2024. See git log for history.*

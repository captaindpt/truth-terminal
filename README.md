# Truth Terminal

A terminal-first “truth stack”: query multiple data sources (social, web, markets, prediction markets, etc.), synthesize signals, and build a durable local substrate for decisions.

## The Vision

You sit down, open the terminal, and ask questions.

Truth Terminal pulls data from whatever sources you’ve wired in (prediction markets, social, web research, financial markets, scrapers), then produces structured outputs you can scan quickly: theses, uncertainties, what would change the call, links/evidence, and “what’s priced vs what isn’t”.

The north star is velocity: if you find a new high-signal source, you should be able to add an integration fast and immediately query it.

Trading/execution can exist as one integration, but it’s not the identity of the project.

## Current Status

Core integrations working:

- Prediction market research pipeline (Polymarket ingestion + multi-source case building)
- Grok/xAI Live Search (X/Twitter + web + news)
- YouTube transcript extraction
- SQLite persistence for cases/outputs
- Polymarket manipulation detection subsystem (`src/manipulation/`)

## Quick Start

```bash
npm install
cp .env.example .env
# Add your API keys to .env:
#   ANTHROPIC_API_KEY=sk-ant-...
#   GROK_API_KEY=xai-...
```

### Commands

```bash
# Prediction-market research
# List top markets by volume
npm run phase0:list

# Basic research (Claude only)
npm run phase0 516719

# Full multi-source research (Grok + Claude)
npm run research 516719
npm run research:quick 516719   # Faster, same sources

# Test individual components
npm run test:grok "Russia Ukraine ceasefire"
npm run test:youtube <video-id>

# Manipulation detection (Polymarket)
npm run stream
npm run stream:enrich
npm run stream:detect
npm run stream:stats
```

## Architecture

Truth Terminal is evolving from “Polymarket research” into a general-purpose query + synthesis terminal:

- **Sources (pluggable):** X/Twitter, web/news, prediction markets, financial markets, scrapers, etc.
- **Processing:** enrichment, normalization, caching, and (optionally) LLM analysis/synthesis
- **Outputs:** structured cases, logs, and local databases you can grep/query

## Project Structure

```
src/
├── agents/
│   ├── claude.ts       # Claude SDK, basic research
│   ├── grok.ts         # Grok Live Search (X + web + news)
│   ├── youtube.ts      # YouTube transcript extraction
│   └── research.ts     # Multi-source research orchestrator
├── polymarket/
│   └── client.ts       # Polymarket API client
├── manipulation/        # Polymarket manipulation detection
├── db/
│   └── index.ts        # SQLite for cases, decisions, trades
├── types/
│   └── market.ts       # Type definitions
├── phase0.ts           # Basic single-source research
├── test-grok.ts        # Grok integration test
├── test-youtube.ts     # YouTube transcript test
└── test-research.ts    # Full pipeline test
```

## Intel Sources

| Source | Status | Cost | What it provides |
|--------|--------|------|------------------|
| Polymarket API | ✅ | Free | Market data, prices, volume |
| Grok Live Search | ✅ | $25/1k sources | Twitter/X + web + news |
| YouTube Transcripts | ✅ | Free | Video content analysis |
| Claude Sonnet | ✅ | API pricing | Analysis and synthesis |
| Financial markets (TBD) | 🔜 | Varies | Prices, flows, fundamentals |

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

- SQLite database: `data/truth-terminal.db`
- JSON case files: `data/cases/`

## Development Roadmap

- [x] Prediction market research (Polymarket)
- [x] Social/web search (Grok) + YouTube ingestion
- [x] Manipulation detection (Polymarket)
- [ ] Unify “query tool” interface across sources
- [ ] Add financial market data integration(s)
- [ ] Add additional prediction markets
- [ ] Add fast scraping integrations (as-needed)
- [ ] Improve review UX (terminal/CLI)

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

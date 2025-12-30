# Truth Terminal

AI-powered prediction market research system. A hierarchical multi-agent architecture where specialized agents research Polymarket bets, and you remain the final decision-maker.

## The Vision

You sit down, open the orchestrator. It's been watching Polymarket - hundreds of markets. The system has pre-filtered to 20-30 that have mispricing signals, sufficient liquidity, or time-sensitivity.

For each, research agents have built cases: news, Twitter sentiment, expert commentary, historical context. Each case has a thesis, confidence level, key uncertainties, and what would change the assessment.

You scroll through. Most you dismiss in seconds. But a few click. You drill in, ask the orchestrator questions. It can go deeper on demand - more searches, steelman the opposite position.

When ready, you approve. The system executes on Polymarket.

## Current Status

**Phase 0-3 Complete.** Core research pipeline working:

- Polymarket API integration (free, full market data)
- Grok/xAI Live Search (Twitter/X + web + news)
- YouTube transcript extraction
- Claude synthesis into structured cases
- SQLite persistence

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
```

## Architecture

```
                    ┌─────────────┐
                    │     You     │
                    │ (Intuition) │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Orchestrator│ ← Claude (judgment layer)
                    │    Agent    │
                    └──────┬──────┘
                           │
    ┌──────────────────────┼──────────────────────┐
    │                      │                      │
┌───▼───┐            ┌────▼────┐            ┌────▼────┐
│ Grok  │            │ YouTube │            │ Claude  │
│ X/Web │            │Transcripts│           │Research │
└───┬───┘            └────┬────┘            └────┬────┘
    │                     │                      │
    └─────────────────────┼──────────────────────┘
                          │
                   ┌──────▼──────┐
                   │ Polymarket  │
                   │     API     │
                   └─────────────┘
```

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
| Alpha Vantage | 🔜 | Free tier | Stock/crypto data |

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

- [x] Phase 0: Basic research loop
- [x] Phase 1: Polymarket ingestion
- [x] Phase 2: Single-agent research
- [x] Phase 3: Multi-source research (Grok, YouTube)
- [ ] Phase 4: Review CLI/UI
- [ ] Phase 5: Trade execution
- [ ] Phase 6: Calibration loop

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

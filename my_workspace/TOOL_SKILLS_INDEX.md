# Tool Skills Index

Each tool is documented as a standalone skill file (keeps context modular and easy to load selectively).

## Current tool skill files

- `my_workspace/skills/tool-grok-search/SKILL.md` (tool: `grok_search`)
- `my_workspace/skills/tool-gdelt-news/SKILL.md` (tool: `gdelt_news`)
- `my_workspace/skills/tool-polymarket-trades/SKILL.md` (tool: `polymarket_trades`)
- `my_workspace/skills/tool-polymarket-book/SKILL.md` (tool: `polymarket_book`)
- `my_workspace/skills/tool-coingecko-price/SKILL.md` (tool: `coingecko_price`)
- `my_workspace/skills/tool-nasdaq-quote/SKILL.md` (tool: `nasdaq_quote`)
- `my_workspace/skills/tool-nasdaq-candles/SKILL.md` (tool: `nasdaq_candles`)

## How to execute a tool (local)

```bash
curl -sS -X POST http://127.0.0.1:7777/api/tools/execute \
  -H 'Content-Type: application/json' \
  -d '{"name":"gdelt_news","params":{"query":"tesla","limit":5}}'
```

## Notes

- `grok_search` is paid; prefer `gdelt_news` for a free first pass.
- Many tools return `meta.durationMs` and/or `meta.cached` for quick latency visibility.


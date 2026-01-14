# TODO - Future Work

## Immediate (Next Session)

- [ ] Check stream is still running (`tail -f data/stream.log`)
- [ ] Run `npm run stream:enrich` to get more wallet ages
- [ ] Run `npm run stream:detect` and review findings
- [ ] Investigate any fresh wallets with concentrated bets

---

## Direction: Truth Terminal (Unified Query Tool)

- [ ] Define a consistent “query tool” interface for all sources (inputs/outputs, caching, logging)
- [ ] Create a lightweight pattern for adding new integrations quickly (e.g., one file + registry)
- [ ] Decide how Mani’s separate Twitter tool plugs in (reuse code vs call as a service)
- [ ] Add at least one financial markets integration (prices/volatility/newsflow)
- [ ] Add at least one additional prediction market integration

---

## Manipulation Detection: Enhanced Detection

- [ ] **Topic clustering** - Group markets by entity (Venezuela, Google, etc.)
  - Parse market titles for named entities
  - Flag wallets that only trade one topic

- [ ] **Wallet cluster detection** - Find wallets that trade together
  - Same markets, similar timing
  - Could be one person with multiple accounts

- [ ] **Real-time alerts** - Trigger during collection
  - Add detection logic to stream.ts onTrade callback
  - Log alerts immediately, don't wait for report

---

## Manipulation Detection: Win Rate Tracking

- [ ] Fetch resolution data from API
- [ ] Calculate win rate per wallet
- [ ] Flag statistical anomalies (>80% over 10+ markets)

---

## Cross-Integration Ideas

- [ ] When manipulation detected, auto-pull more context (news/social/web) for that market
- [ ] “Follow the smart money” workflows (alerts → context → decision)

---

## Technical Debt

- [ ] Some market titles show as condition_id (enrichment incomplete)
- [ ] Wallet age calculation might be off (API returns limited history)
- [ ] No graceful shutdown of stream (just kill)
- [ ] Detection queries could be optimized with better indexes

---

## Ideas from Research

- [ ] Pentagon pizza tracker (@PenPizzaReport) - alternative data signals
- [ ] Funding source analysis - trace wallets to exchanges
- [ ] Dune Analytics integration - historical Polygon data
- [ ] PolyTrack API - if they expose cluster data

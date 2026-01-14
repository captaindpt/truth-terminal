# TODO - Future Work

## Immediate (Next Session)

- [ ] Check stream is still running (`tail -f data/stream.log`)
- [ ] Run `npm run stream:enrich` to get more wallet ages
- [ ] Run `npm run stream:detect` and review findings
- [ ] Investigate any fresh wallets with concentrated bets

---

## Phase 2: Enhanced Detection

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

## Phase 3: Win Rate Tracking

- [ ] Fetch resolution data from API
- [ ] Calculate win rate per wallet
- [ ] Flag statistical anomalies (>80% over 10+ markets)

---

## Phase 4: Integration with Research System

- [ ] When manipulation detected, auto-research that market
- [ ] "Follow the smart money" — if insider buys, investigate why
- [ ] Alert Mani to piggyback on insider trades

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

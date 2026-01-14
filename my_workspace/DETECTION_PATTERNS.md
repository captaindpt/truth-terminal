# Manipulation Detection Patterns

## Pattern 1: Fresh Concentrated Wallet

**Signal:** New wallet betting big on few related markets.

**Example:** Venezuela insider
- Wallet age: 8 days
- Markets: 5 (all Venezuela-related)
- Volume: $350K+
- Entry price: 5-9%

**Query (in detect.ts):**
```sql
WHERE wp.first_seen > (now - 30 days)
  AND wp.unique_markets <= 5
  AND t.side = 'BUY'
  AND t.price < 0.20
  AND wp.total_volume > 1000
```

---

## Pattern 2: Single-Market Specialist

**Signal:** Wallet only trades one market with conviction.

**Why suspicious:** Normal traders diversify. Single-market focus with size = specific knowledge.

**Query:**
```sql
WHERE wp.unique_markets = 1
  AND t.side = 'BUY'
  AND SUM(t.size) > 500
```

---

## Pattern 3: Low-Odds Buyer

**Signal:** Buying at <10% odds with meaningful size.

**Why suspicious:** At 10%, you need 10x to break even. Requires high conviction.

**Query:**
```sql
WHERE t.side = 'BUY'
  AND t.price < 0.10
  AND t.size > 100
```

---

## Pattern 4: Concentrated Market

**Signal:** Few wallets dominating a market's volume.

**Why suspicious:** Could indicate coordination or single actor with multiple wallets.

**Query:**
```sql
GROUP BY market_id
HAVING total_vol > 1000 AND unique_wallets <= 3
```

---

## Pattern 5: Coordinated Timing (Not Implemented Yet)

**Signal:** Multiple wallets trading same market within short time window.

**Why suspicious:** Suggests coordination (Telegram group, insider ring).

**Query idea:**
```sql
SELECT market_id, COUNT(DISTINCT wallet),
       MAX(timestamp) - MIN(timestamp) as time_span
WHERE time_span < 60000  -- within 1 minute
GROUP BY market_id
HAVING COUNT(DISTINCT wallet) >= 3
```

---

## Pattern 6: Win Rate Anomaly (Not Implemented Yet)

**Signal:** Wallet has >80% win rate across 10+ resolved markets.

**Why suspicious:** Statistically improbable without information edge.

**Need:** Resolution data from API (not currently collected).

---

## Anti-Patterns (False Positives)

### Market Makers / Bots
- High trade count (500+)
- Many markets (100+)
- Diversified
- Not suspicious — they provide liquidity

### Crypto Price Markets
- Many wallets trading ETH/BTC up/down
- Short-term gambling, not insider trading
- Filter by category

### Old Resolved Markets
- Some queries return ancient markets (Biden COVID, etc.)
- Filter by end_date or active status

---

## Ground Truth Cases

### Venezuela Insider (Jan 2026)
- Wallet: `0x31a56e9E690c621eD21De08Cb559e9524Cdb8eD9`
- Pattern: Fresh + Concentrated + Low-Odds
- Result: $35K → $442K

### Google Search Insider ("AlphaRaccoon")
- 22-for-23 wins on Google search predictions
- Pattern: Win Rate Anomaly + Single-Company Focus
- Result: $3M deposited, suspected Google employee

### Nobel Prize Insider ("6741")
- Single transaction wallet
- $50K bet hours before announcement
- Pattern: Fresh + Single-Market + Large Size

---

## Tuning Notes

- "Fresh" threshold: 14-30 days seems right
- "Concentrated" threshold: ≤5 markets
- "Large" size: >$1K for whale, >$100 for signal
- "Low odds": <15% is interesting, <5% is very suspicious

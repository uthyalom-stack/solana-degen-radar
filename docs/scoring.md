# Scoring model

Scores are deterministic heuristics for sorting research candidates. They are not probabilities, investment recommendations, or guarantees of safety. Keep the component evidence alongside each score and recalibrate against timestamped historical outcomes before using scores for decisions.

## Narrative score (0–100)

The shared function normalizes each input to 0–100 and applies these weights:

| Dimension | Weight | Current input interpretation |
|---|---:|---|
| Mention growth | 30% | Number of narrative signals captured in the last 24 hours, scaled by eight per mention |
| Source coverage | 20% | Distinct source identifiers in the last 24 hours, scaled by 25 per source |
| Engagement acceleration | 15% | Log-scaled sum of reported engagement metrics |
| Novelty | 10% | 100 for narratives first observed within 24h, 50 within 72h, otherwise 0 |
| Cross-platform spread | 15% | Distinct source prefixes/platforms, scaled by 35 |
| Persistence | 10% | Distinct active UTC dates in the 24h window, scaled by 25 |

The current keyword taxonomy is intentionally small and transparent. A narrative with zero recent signals can still exist in storage, but its score will fall as its recent activity disappears.

## Momentum score (0–100)

Momentum combines one-hour price change, one-hour volume relative to liquidity, and buy share of one-hour transactions. Missing market values currently fall back to neutral/zero inputs, so inspect raw snapshots and do not interpret a low score as an absence of activity.

## Risk score (0–100; higher means more risk)

Risk starts at 50 and adjusts for observed liquidity, FDV/liquidity, pair age, volume/liquidity, sell pressure, mint authority, and freeze authority. Unknown inputs add a bounded uncertainty penalty. `partial` means at least one relevant field was unavailable or not checked; it does not mean the token passed checks.

The current implementation does not measure holder concentration, LP lock/burn, honeypot behavior, creator-wallet history, or actual sellability. Those indicators must be added with auditable sources before claiming comprehensive risk coverage.

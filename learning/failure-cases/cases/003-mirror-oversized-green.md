# Case 003: Mirror UP — “strong green” is an oversized spike bar

- **Date observed:** 2026-03-28
- **Context:** Chart review (screenshot); symbol / timeframe—add if logged elsewhere.
- **Signal:** **UP — Mirror**
- **Reported engine reason:** weakening reds and strong green
- **Outcome:** **Wrong** for the user’s playbook — the qualifying green is **too large** relative to recent structure; a **moderately strong** green would match intent better than a **single outlier** candle.

## What actually happened

- Before the signal: a run of **red candles** that **weaken** (smaller bodies, **lower wicks**, slowing downside)—reasonable “mirror” prep.
- The **signal green** is a **very large** bullish candle: body is an **outlier** vs the prior ~8–10 bars (several times larger than the small reds). It **breaks from well below** the yellow EMA **to clearly above** in one print—classic **climax / impulse spike**, not a modest reversal confirmation.
- **User read:** For Mirror, the reversal green should be **“strong” but not this big**—a **bit smaller** green would be the right scale; this bar is **too extended** to treat like a normal Mirror entry.

## Why it failed (hypothesis)

- The rule only checks **weak reds + strong green** in a binary sense, not **relative size** of the green vs recent volatility or vs median body size. A **news-level or squeeze** bar still satisfies “strong green” but is a **different regime** (chase / exhaustion risk) than a controlled reversal.
- **“Strong”** needs an **upper bound** as well as a lower bound, or normalization (e.g. body vs ATR, vs rolling median body).

## Proposed direction (design only — no code yet)

- **Cap “strong green”** for Mirror: e.g. body (or range) **≤ X ×** median body of last N bars, **or** ≤ **Y × ATR**, so **spike bars** are excluded or tagged differently.
- **Alternative:** require green body in a **band** between “strong enough” and “not largest bar of the month.”
- Compare with Cases 1–2: Case 1 = **streak timing**; Case 2 = **location (support)**; Case 3 = **bar-size / outlier filter** on the confirming candle.

## Evidence

- Chart: [`003-mirror-green-too-large-chart.png`](003-mirror-green-too-large-chart.png) (weakening reds; then an **exceptionally large** green crossing the EMA; smaller bars after suggest the spike was the anomaly).

## Tags

- `mirror`, `up`, `weakening-reds`, `strong-green`, `outlier`, `body-size`, `spike`, `ema-break`

## Follow-up

- When synthesizing: decide whether this is **Mirror-only** or shared with **Momentum** “strong candle” definitions.  
- Tune whether filter is **suppress** vs **new label** (e.g. “Mirror spike / news bar”).

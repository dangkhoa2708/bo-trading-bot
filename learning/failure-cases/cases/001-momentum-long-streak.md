# Case 001: Momentum UP after many greens (late entry)

- **Date observed:** 2026-03-28
- **Context:** Chart review (screenshot); symbol / timeframe not specified in log—add if you have them.
- **Signal:** **UP — Momentum**
- **Reported engine reason:** 3 strong greens, close > EMA20
- **Outcome:** **Wrong direction vs next candle** — price had already run up with a long green streak; the candle after the signal showed a sharp red pullback (classic late momentum / exhaustion of the micro-streak).

## What actually happened

- The chart shows a **long consecutive run of green candles** (on the order of **~7 greens** in a row into the signal area), not a fresh “just turned” 3-candle impulse. The signal candle sits **under extended upside** with a notable upper wick; the **next candle** is a **large red** move down.
- **Timing:** In this run, the bot **actually fired on the 6th green candle**. Retrospectively, the **3rd green** would have been a **much better** place to signal—still early in the impulse, before the market had already stretched and become pullback-prone.
- **Baseline / next close:** fill from your backtest row or platform if you want exact numbers; qualitatively the setup failed because continuation did not hold on the very next bar.

## Why it failed (hypothesis)

- The rule text **“3 strong greens”** matches a **window** or “last 3” condition, but **does not cap how many greens already ran before** those three. So the model can still fire **deep into a streak**, when mean reversion / pullback risk is high.
- **Momentum as defined** is ambiguous: “early trend leg” vs “any segment where the last 3 candles are strong.” This case is the latter while behaving like the former in the UI label.

## Proposed direction (design only — no code yet)

- **Required — cap total impulse (longer lookback):** Do **not** signal if the move has already exceeded **N same-direction bodies in a row** in a **wider window**, treating **micro pauses** (tiny counter candles) as **not** resetting the impulse. This blocks alerts **deep in a run** (e.g. **6th** green) when “last 3 strong” is still true. Same idea for DOWN (see Case 004).
- **Strict streak / first-fire-at-3:** Treat Momentum UP when the **bullish run** matches **early leg** intent—e.g. **exactly 3** greens from reset, or fire **once** when streak first hits 3—not a sliding window that stays valid on bar 4, 5, 6…
- **Also compare:** require “3 strong greens **and** prior candle was not strong green” (reset detection); tune **N** and pause definition in config.

## Evidence

- Chart: [`001-momentum-long-streak-chart.png`](001-momentum-long-streak-chart.png) (crosshair on signal candle; EMA20-style line under price; long green run then sharp red next bar).

## Tags

- `momentum`, `overextended`, `streak-length`, `late-entry`, `pullback-after-run`, `ema20`

## Follow-up

- When batching solutions: tie this to **streak / window definition** for Momentum vs **Exhaustion** (if Exhaustion is meant to catch “many same-color candles,” this case may be a product mis-label or missing guard).  
- Confirm whether “exactly 3” should apply to both UP and DOWN Momentum for symmetry.

# Case 005: Momentum DOWN — good local 3 reds, but near support on a wide lookback

- **Date observed:** 2026-03-28
- **Context:** Chart review (screenshot); symbol / timeframe—add if logged elsewhere.
- **Signal:** **DOWN — Momentum**
- **Reported engine reason:** `3 strong reds, close < EMA20`
- **Outcome:** **Wrong vs next bars** — locally the **three red candles** read as a **valid** momentum pattern, but price is **back at a support zone** when you zoom out; **pullback / bounce** follows (green candles after the signal).

## What actually happened

- **Local pattern:** **Three consecutive strong reds**, closes **below** the sloping yellow EMA — in isolation this is a **coherent** DOWN momentum read (user: “3 strong reds here is actually **good signal**.”).
- **Wider context:** If you **scroll back** (user: **~50 candles**), price is **again near a prior low / support zone** (earlier base from the left), not in the middle of nowhere. The signal prints **into** that **dangerous** area—**break or bounce** is uncertain.
- **After signal:** Several **green** candles lift price back toward the EMA — the **downside continuation** thesis failed.

## Why it failed (hypothesis)

- The engine uses **short-window** conditions (3 bars + EMA) and does **not** see **wider** **structure** (major swing lows / prior base from many bars back, repeated support).
- **Same failure mode as [Case 002](002-momentum-into-support.md)** — **location risk** — but **002** was **~5 candles** to the level; **005** shows **support is still relevant** with a **much wider** lookback (**50**), so a single “recent N-bar low” check might **miss** this.

## Proposed direction (design only — no code yet)

- **Swing / support awareness:** Before DOWN Momentum, check **distance to** the **lowest low of a longer window** (e.g. 50–100 bars) or to **identified swing lows** (pivot detection), not only the last few candles.
- **Filter:** Suppress or downgrade when **close** is within **X% / X ticks** of a **wide** support **or** require **close below** that zone for continuation.
- **Contrast Case 004:** Case 4 is **late streak / extension**; Case 5 is **good local momentum** but **bad macro location**.

## Evidence

- Chart: [`005-momentum-down-support-wide-lookback-chart.png`](005-momentum-down-support-wide-lookback-chart.png) (3 reds under EMA; horizontal line / prior base level; greens after).

## Tags

- `momentum`, `down`, `support`, `swing-low`, `wide-lookback`, `50-bar`, `location-risk`, `ema20`

## Related cases

- **[002](002-momentum-into-support.md)** — **Same idea** (momentum into support), **tight** lookback (~5 bars).  
- **[004](004-momentum-down-extended-leg.md)** — **Extension** without requiring a **level** story.

## Follow-up

- When synthesizing: one **support / resistance** module with **configurable lookback** (short vs long) and **buffer** so “near major low” cannot be ignored.

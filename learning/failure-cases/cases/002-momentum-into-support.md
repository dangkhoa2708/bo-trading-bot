# Case 002: Momentum DOWN into prior support (bounce risk)

- **Date observed:** 2026-03-28
- **Context:** Chart review (screenshot); symbol / timeframe—add if you log them elsewhere.
- **Signal:** **DOWN — Momentum**
- **Reported engine reason:** `3 strong reds, close < EMA20`
- **Outcome:** **Wrong vs next candle** — price bounced; continuation down did not follow on the next bar.

## What actually happened

- **Timing of the rule:** The signal **did** fire on the **3rd red candle**, which is the “good” timing from Case 001’s perspective (not late in a long same-color run).
- **Context:** Roughly **5 candles back** there is a clear **prior low / support zone** (from a red candle with a long lower wick). The **3rd red (signal) closes near or on that support**—the chart shows the close lining up with that horizontal zone.
- **Next candle:** Green bounce off support instead of further downside.

## Why it failed (hypothesis)

- Momentum DOWN is defined only from **candle shape + EMA**, not from **distance to recent structural lows**. At a **test of support**, breakdown vs bounce is **ambiguous**; labeling it as pure “momentum” continuation ignores **location risk**.
- **“We don’t know if it will break or hold”** — so signaling here is a **coin flip at a level**, not a clean impulse continuation.

## Proposed direction (design only — no code yet)

- **Filter or downgrade** Momentum DOWN when price is **within X% / X ticks of a recent swing low** (e.g. lowest low of last N bars, or the support defined ~5 bars ago in this example).
- **Alternative:** require **close below** that support zone for a DOWN momentum alert (breakdown confirmation), not merely “3 reds + under EMA” **at** the level.
- Compare with Case 001: there the issue was **late streak**; here **streak length is fine**, but **key level proximity** invalidates the trade idea.

## Evidence

- Chart: [`002-momentum-into-support-chart.png`](002-momentum-into-support-chart.png) (vertical line on 3rd red; horizontal support from ~5 candles prior; bounce on the next bar).

## Tags

- `momentum`, `down`, `support`, `swing-low`, `bounce`, `location-risk`, `ema20`

## Follow-up

- When synthesizing: define **how to detect “near support”** programmatically (recent N-bar low, ATR buffer, etc.) and whether to **suppress** vs **relabel** (e.g. exhaustion / level test).  
- Pair with any **resistance**-symmetric rule for UP momentum.

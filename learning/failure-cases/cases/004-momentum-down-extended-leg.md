# Case 004: Momentum DOWN — late in an already-extended down leg (cf. Case 1)

- **Date observed:** 2026-03-28
- **Context:** Chart review (screenshot); symbol / timeframe—add if logged elsewhere.
- **Signal:** **DOWN — Momentum**
- **Reported engine reason:** `3 strong reds, close < EMA20`
- **Outcome:** **Wrong / high pullback risk** — price had already been **moving down for several bars**; the alert fires when continuation is **crowded** and a **bounce** is easy next.

## What actually happened

- In the **last ~5–6 candles**, there are **already multiple red / down candles** in the same leg (steep decline, price well under the sloping EMA). A **small green** candle in the middle **does not** reset the picture—it reads as a **pause / fake**, not a new up regime.
- By the time the rule’s **“3 strong reds”** lines up with `close < EMA20`, you are **not** at the **start** of the impulse; you are **deep** in a move that has been printing bearish pressure for a while—**similar to Case 001** (many same-direction candles before the signal).
- **Retrospective nuance:** The **first two strong reds** and the **tiny green at the third** position could argue **“continue down”** in narrative terms—but the **system signal** as experienced still aligns with a **late** momentum tag when the **next** bar can naturally **pull back** (green on the chart after the marked candle).

## Why it failed (hypothesis)

- **“Last 3 strong reds”** can stay true **after** a long red run; a **small green** may not be excluded by the rule, so the model still **fires late**.
- **Pullback risk** rises after **extension**; Momentum DOWN should arguably require **early leg** or **fresh streak**, not “any window where the last 3 bars are strong red.”

## Proposed direction (design only — no code yet)

- **Required — cap total impulse (longer lookback):** Same as [Case 001](001-momentum-long-streak.md): do **not** signal if there are already **≥ N same-direction bodies** in the impulse (wider lookback), **excluding micro pauses** as resets. This directly addresses **5–6 reds deep** + fake green: the leg is **too extended** to call “momentum” here.
- **Pair with Case 001:** **Same-color run from reset** (exactly / at most K bars) so “last 3 strong reds” cannot fire **late** in an already-long leg.
- **Optional (implementation detail):** treat **tiny counter candle** (`body < threshold` vs ATR or vs prior bar) as **still inside** the down streak when counting impulse length.
- **Contrast Case 002:** Case 2 failed on **support location**; Case 4 fails on **extension / late timing** even without a level story.

## Evidence

- Chart: [`004-momentum-down-late-streak-chart.png`](004-momentum-down-late-streak-chart.png) (extended down leg; small green between large reds; crosshair on later strong red; green pullback after).

## Tags

- `momentum`, `down`, `late-entry`, `extended-leg`, `fake-green`, `streak`, `pullback`, `ema20`

## Related cases

- **[001](001-momentum-long-streak.md)** — UP side: **many greens** before signal; **6th green** vs ideal **3rd**. Same theme: **rule stays true too long**.
- **002** — **Support bounce** (location), not streak length.

## Follow-up

- When synthesizing: one **unified “early momentum / streak reset”** rule for both directions, plus how **small counter candles** affect streak count.

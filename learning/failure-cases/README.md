# Failure cases (analysis log)

**Purpose:** Capture real mispredictions and near-misses as you encounter them—not to fix code immediately, but to **collect evidence** and **patterns**. After enough cases are documented, you can compare them and choose **one coherent set of changes** (rules, filters, thresholds) instead of patching one-off.

**Workflow (no implementation in this phase):**

1. You observe a failure (backtest row, live alert, chart review).
2. You add a new file under `cases/` using the template below (or paste the template into a dated note).
3. Repeat until you feel you have a representative set.
4. Then: group by **setup / regime / failure mode** and define an **optimized solution** once.

**Conventions**

- One file per case: `cases/001-short-slug.md`, `cases/002-...md`, etc. (or any naming you prefer—keep them sortable).
- Status for each case: `draft` → `analyzed` → `queued-for-design` (optional).
- Link screenshots or TradingView URLs in the “Evidence” section if helpful.

---

## Case index

_Add links or filenames as you go._

| # | File / slug | Setup / tag | Status |
|---|-------------|-------------|--------|
| 1 | [`cases/001-momentum-long-streak.md`](cases/001-momentum-long-streak.md) | Momentum UP / streak | analyzed |
| 2 | [`cases/002-momentum-into-support.md`](cases/002-momentum-into-support.md) | Momentum DOWN / support | analyzed |
| 3 | [`cases/003-mirror-oversized-green.md`](cases/003-mirror-oversized-green.md) | Mirror UP / green too large | analyzed |
| 4 | [`cases/004-momentum-down-extended-leg.md`](cases/004-momentum-down-extended-leg.md) | Momentum DOWN / late leg | analyzed |
| 5 | [`cases/005-momentum-down-support-wide-lookback.md`](cases/005-momentum-down-support-wide-lookback.md) | Momentum DOWN / support (wide) | analyzed |

---

## Template (copy into `cases/NNN-slug.md`)

```markdown
# Case NNN: <short title>

- **Date observed:** YYYY-MM-DD
- **Context:** backtest / live / replay — symbol, timeframe if relevant
- **Signal:** UP / DOWN / (direction + setup name from your RULES if applicable)
- **Outcome:** wrong / deferred / unclear — one line

## What actually happened

- Baseline / next close (if known):
- Price path note (spike, chop, gap, etc.):

## Why it failed (hypothesis)

- Bullet hypotheses—engine? dispatcher? market regime? noise?

## Evidence

- Chart note or link
- Log / report snippet (redact secrets)

## Tags

- e.g. `momentum`, `exhaustion`, `whipsaw`, `mirror`, `after-hours`, `low-vol`

## Follow-up

- Leave empty until you batch-design fixes; then note which grouped solution this case informs.
```

---

## Synthesis

- **[synthesis-2026-03.md](synthesis-2026-03.md)** — cross-case fixes; **every candidate signal should be reconfirmed on a longer lookback** before emit; **capping total impulse** is the **Momentum** slice of that (and is **required**, not optional).

### Later: deeper synthesis (when you are ready)

You can extend that note or add `synthesis-YYYY-MM.md` with:

- Recurring failure modes
- Proposed rule changes / filters with **which case IDs** support each change
- What you will **not** change (and why)

No code until that synthesis feels solid.

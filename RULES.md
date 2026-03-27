# Trading Bot Source of Truth

This file is the single source of truth for strategy behavior and operating constraints in this repo.
For setup, run instructions, and operational notes, see `README.md`.

## Scope

- Pair: `BNBUSDT`
- Timeframe: `5m`
- Purpose: emit `UP` / `DOWN` signals for the next candle, or `NONE`
- Current execution mode: signal bot (Telegram + logs), no exchange order placement

## Candle Processing Rules

- Process only closed 5m candles from Binance kline stream (`k.x = true`)
- Keep a rolling candle buffer (default `50`)
- Bootstrap startup history using REST klines before live stream
- Evaluate on each closed candle

## Skip Rules (No Trade / No Signal)

- Choppy: last `CHOP_LOOKBACK` candles alternate color
- ATR band filter:
  - compute `ATR_PERIOD`
  - skip when `atr/close < MIN_ATR_PCT` (too quiet)
  - skip when `atr/close > MAX_ATR_PCT` (too chaotic)
- Low volatility: median range of recent 5 candles is below `LOW_VOL_FACTOR *` median range of last `LOW_VOL_COMPARE`
- Sideways: `abs(close - EMA20) / close < SIDEWAYS_EMA_PCT`
- Warmup: not enough candles to compute signals/EMA

## Setup Rules

### Setup A: Momentum Continuation

- Last 3 candles are same color (all green or all red)
- Each of those 3 bodies is at least `MOMENTUM_BODY_VS_AVG *` recent average body
- Each of those 3 ranges is at least `MOMENTUM_RANGE_VS_AVG *` recent average range
- Each has strong close (body/range >= `MIN_BODY_TO_RANGE`)
- Each closes near its directional extreme:
  - green: `(high-close)/range <= MAX_CLOSE_TO_EXTREME_PCT`
  - red: `(close-low)/range <= MAX_CLOSE_TO_EXTREME_PCT`
- EMA filter:
  - Bullish momentum valid only if close > EMA20 -> signal `UP`
  - Bearish momentum valid only if close < EMA20 -> signal `DOWN`

**Why you might see no momentum during a “clear” chart uptrend**

- **Wicks / grind**: steady climbs often have upper wicks or modest bodies; strict `MAX_CLOSE_TO_EXTREME_PCT` + `MIN_BODY_TO_RANGE` reject those candles even when the trend looks obvious.
- **Baseline**: body/range are compared to the prior `BODY_LOOKBACK` window; after volatility, recent candles can look “weak” vs that average.
- **Skip filters run first**: choppy / low-vol / sideways / ATR can return `NONE` before momentum is evaluated.
- **EMA**: bullish momentum needs **close > EMA20**; price hugging or below the EMA does not qualify.

### Setup B: Exhaustion Reversal

- Prior run has at least `EXHAUSTION_RUN_MIN` same-color candles
- Latest candle is opposite color with strong body/close
- Latest reversal candle must close near its directional extreme (`MAX_CLOSE_TO_EXTREME_PCT`)
- Latest reversal candle range must be within previous candle range ×
  [`EXHAUSTION_REV_MIN_PREV_RANGE_MULT`, `EXHAUSTION_REV_MAX_PREV_RANGE_MULT`]
- Weakening evidence required from run:
  - shrinking body and/or
  - increasing wick pressure on trend side
- If prior run was green -> signal `DOWN`
- If prior run was red -> signal `UP`

### Setup C: Mirror Cases

- Weak red sequence followed by strong green close -> signal `UP`
  - Guard: require close to be near/above EMA20 (avoid dead-cat bounces below EMA)
  - Guard: skip Mirror UP for a short window after a large red dump candle (range vs ATR)
- Strong red momentum can still emit `DOWN` as mirror when momentum-down exists but EMA filter blocks classic momentum condition

## Setup Evaluation Priority

Evaluation order is fixed:

1. Skip filters
2. Exhaustion
3. Mirror (weak red -> strong green)
4. Momentum (+ EMA side filter)
5. Mirror fallback for strong red momentum
6. Otherwise `NONE`

## Signal Dispatch Rules

- Do not emit if strategy output is `NONE`
- Do not emit twice for the same candle open time
- Do not emit same direction back-to-back

## Alert and Logging Contract

- Telegram message includes:
  - Pair
  - Signal (`UP`/`DOWN`)
  - Setup (`Momentum`/`Exhaustion`/`Mirror`)
  - Price
  - Reason
- Every emitted signal is appended to `logs/signals.jsonl` with timestamp and metadata

## Risk Rules (Operational Policy)

- Fixed size per trade (for future execution module)
- No martingale
- Session cap: 5-10 trades
- Stop after 3 consecutive losses
- Daily loss limit: -3% to -5%

Note: risk rules are policy-level constraints now; execution enforcement is future work because this version is signal-only.

## Config Defaults

From `src/config.ts`:

- `symbol="BNBUSDT"`
- `candleBuffer=50`
- `emaPeriod=20`
- `bodyLookback=20`
- `momentumBodyVsAvg=0.72`
- `momentumRangeVsAvg=0.72`
- `minBodyToRange=0.42`
- `maxCloseToExtremePct=0.38`
- `exhaustionRunMin=4`
- `exhaustionRevMinPrevRangeMult=0.3`
- `exhaustionRevMaxPrevRangeMult=0.5`
- `chopLookback=3`
- `lowVolFactor=0.38`
- `lowVolCompare=20`
- `atrPeriod=14`
- `minAtrPct=0.00005`
- `maxAtrPct=0.03`
- `sidewaysEmaPct=0.0005`
- `dryRun=false`

## Change Control

- Any change to strategy logic must update this file in the same PR/commit.
- If this file and implementation diverge, fix both immediately so behavior and documentation stay aligned.

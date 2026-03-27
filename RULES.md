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

From `env.example`:

- `SYMBOL=BNBUSDT`
- `CANDLE_BUFFER=50`
- `EMA_PERIOD=20`
- `BODY_LOOKBACK=20`
- `MOMENTUM_BODY_VS_AVG=1`
- `MOMENTUM_RANGE_VS_AVG=0.9`
- `MIN_BODY_TO_RANGE=0.55`
- `MAX_CLOSE_TO_EXTREME_PCT=0.25`
- `EXHAUSTION_RUN_MIN=4`
- `EXHAUSTION_REV_MIN_PREV_RANGE_MULT=0.4`
- `EXHAUSTION_REV_MAX_PREV_RANGE_MULT=0.7`
- `CHOP_LOOKBACK=4`
- `LOW_VOL_FACTOR=0.45`
- `LOW_VOL_COMPARE=20`
- `ATR_PERIOD=14`
- `MIN_ATR_PCT=0.00005`
- `MAX_ATR_PCT=0.03`
- `SIDEWAYS_EMA_PCT=0.001`
- `DRY_RUN=1`

## Change Control

- Any change to strategy logic must update this file in the same PR/commit.
- If this file and implementation diverge, fix both immediately so behavior and documentation stay aligned.

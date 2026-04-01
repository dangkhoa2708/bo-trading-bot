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

## Alert dispatch (Telegram / logs)

Backtest showed **Mirror** did better with **same-direction dedupe** (skip when the new alert direction matches the **previous emitted** alert, any setup). **Momentum** and **Exhaustion** did better when **every** engine `UP`/`DOWN` is counted.

- **Mirror:** `mirrorAllowRepeatSameDirection` in `src/config.ts` (default **false**) — strict Mirror dedupe (no same-direction back-to-back Mirror emits). Set **`true`** to allow repeat-direction Mirror alerts for manual review (noisier).
- **Momentum** and **Exhaustion:** at most one alert per candle open time; **same-direction back-to-back is allowed**.

Implemented via `usesStrictDirectionDedupe(setup)` in `src/signal/dispatcher.ts` (backtest uses the same dispatcher).

## Human review (pre-prediction)

- After the **pre-prediction** message, the bot sends **5** reminder Telegram messages, **1 second apart**, plain text: `**Signal Alert** 🔔` (no HTML parse mode), to draw attention.
- After each emitted signal, the merged **signal / pre-prediction** Telegram message includes **My pick: UP / DOWN** inline buttons.
- If you tap a button before the **next** candle closes, that choice is stored (`src/prediction/humanPick.ts`) and used as **`expected`** in `logs/predictions.jsonl` when the next candle resolves (falls back to the **bot** direction if you do not tap). There is **no** Telegram “post-prediction” message on resolve; if you placed a Pancake bet, the **poller / claim** messages are the follow-up. If you did **not** place a bet, the row is logged as **ignored** for reports (see below).
- **Optional on-chain PancakeSwap BNB prediction:** With a wallet key configured (`EXHAUSTION_BSC_WALLET_PRIVATE_KEY` for Exhaustion, `MIRROR_BSC_WALLET_PRIVATE_KEY` for Mirror, or shared fallback `BSC_WALLET_PRIVATE_KEY`), a pre-prediction **UP / DOWN** tap tries **`betBull` / `betBear`** on [PancakePrediction V2](https://developer.pancakeswap.finance/contracts/prediction/addresses) only when the **live** `currentEpoch` is **`_bettable`** (`block.timestamp > startTimestamp` and `< lockTimestamp`). Uses **latest BSC block time** (not server wall clock) and a **fresh read right before broadcast**. If the round is **locked or not open**, the attempt **fails immediately** with ❌ — **no waiting** and **no auto-entry into the next round** (so you are not pushed into an unwanted epoch). **UP → bull**, **DOWN → bear**. Tx uses **`epoch == currentEpoch`**. Wallet must be an **EOA**; **BNB** for stake + gas. **Never commit the keys**. ✅/❌ on Telegram. **Dry-run** does not broadcast.
  - **Stake from a real (strategy) signal:** `PANCAKE_PREDICTION_BET_BNB` in `.env` (must be > 0 for a bet to be sent). Current default is **0.01 BNB** for both **UP** and **DOWN**.
  - Telegram **`/setAmount <bnb>`** updates the in-memory live stake immediately for the running bot process (for example `0.01` or `0.02`). Restarting the bot resets it to the configured default from `src/config.ts`.
  - **Stake from `/fakesignal`:** fixed **0.0015 BNB** (same as `/placement`), **not** `PANCAKE_PREDICTION_BET_BNB`.
- **Telegram `/fakesignal up` or `/fakesignal down`:** queues a test signal using the last closed Binance kline as baseline, appends `signals.jsonl`, registers picks like a real signal, and sends the **same merged Telegram message as a live emit:** signal alert + pre-prediction review in one message, with Pancake **epoch countdown**, chart buttons, and UP/DOWN pick buttons, then reminder pings. The next WebSocket candle close attaches and immediately resolves `pendingPrediction` (same scoring path as live). **Not** available in dry-run. Avoid overlapping a real pending signal.
- **Telegram `/placement up` or `/placement down`:** same bet path as a pre-prediction tap (does not record a human pick). Test stake **0.0015 BNB**; uses the shared fallback wallet `BSC_WALLET_PRIVATE_KEY`.
- **Pancake round outcomes (live only):** After a successful on-chain bet, the bot stores the **epoch** plus **`placementId`** (UUID), **`signalId`** (same as the emitted signal for pre-prediction taps, or `MANUAL_PLACEMENT` for `/placement`), originating **setup** when applicable, and **stake in BNB** (decimal string, e.g. `0.02`) in `logs/pancake-bets-pending.json` (gitignored with `logs/`). Different wallets can hold separate rows for the **same epoch**; replacement only happens for the **same wallet + same epoch** pair. A background poller (~30s) watches BSC and sends Telegram when the round settles: **won**, **lost**, **draw (house)**, or **refund available** (oracle path). The poller **starts at process boot** whenever Telegram is configured (it does **not** wait for the Telegraf command listener to finish `launch()`), so outcome messages are not delayed by long polling startup. If you **won** or a **refund** is available, the message includes an inline **Claim** button that submits **`claim([epoch])`** from the same routed wallet that placed the bet. If you claim elsewhere, the poller records settlement using the stored **estimated payout** and marks **off-bot claim** in the ledger. **Dry-run** does not persist or poll.
- **One-process split architecture:** `SignalDispatcher` keeps **per-setup direction memory** (Mirror no longer dedupes against prior Exhaustion, and vice versa). Pre-prediction taps route **Exhaustion** bets to `EXHAUSTION_BSC_WALLET_PRIVATE_KEY`, **Mirror** bets to `MIRROR_BSC_WALLET_PRIVATE_KEY`, and fall back to shared `BSC_WALLET_PRIVATE_KEY` when a setup-specific wallet is absent. Pending/settled placement rows carry the originating setup so the outcome poller claims from the same routed wallet.
- **Pancake placement P&L log:** Each settled placement is appended to `logs/pancake-placements.jsonl` with **bet / claim / profit** in BNB (wei + decimal fields), **outcome** (`won` / `lost` / `draw` / `refund`), tx hashes when known, and **USDT approximations** from Binance **BNBUSDT** at settlement time (null if the price fetch failed). **Daily / weekly** Telegram reports include a **Pancake placements** summary (totals in BNB and ≈ USDT) and per-placement rows in **Show details**.
- **Signal ↔ prediction ids:** Each line in `logs/signals.jsonl` includes **`signalId`** (deterministic) and **`predictionId`** (UUID assigned when the signal fires). The matching resolution row in `logs/predictions.jsonl` repeats **`signalId`** and the same **`predictionId`**, so the two files join on either field. Settled **`pancake-placements.jsonl`** rows include **`predictionId`** when the bet came from a pre-prediction tap (omitted for `MANUAL_PLACEMENT`). **Daily / weekly** details list **`predictionId`** per signal and, under **On-chain (Pancake)**, any placements linked to that signal (excluding **`/fakesignal`** rows — see below).
- **`logs/predictions.jsonl` on next-candle resolve:** Always includes **baseline / next close**, **`botExpected`**, **`humanPick`** (or null), **`expected`** (scored direction), and **`actual`**. **`result`** is **`PLACEMENT`** if a Pancake bet for that **`predictionId`** was already recorded (pending tracker or settled ledger); **`IGNORED`** if not (no on-chain bet — **Ignored cases** in daily/weekly reports). Older rows may still show **`RIGHT`** / **`WRONG`** (legacy labels). **`PENDING`** would be excluded from win-rate math if present.
- **Daily / weekly Telegram reports** include **Prediction resolution**: counts of **Ignored (no bet)** and **With Pancake bet**. **Bot prediction** and **My picks** win rates count **every resolved row** with a next-candle **`actual`** (including **`IGNORED`** and **`PLACEMENT`**) vs **`botExpected`** / your **`humanPick`**. Per-signal details describe ignored vs placement rows in plain language. Plus **Pancake placements** as above. Rows from **`/fakesignal`** and fake-linked placements remain **omitted** from report totals (see above).

## Skip Rules (No Trade / No Signal)

Concrete numbers are in `src/config.ts`. The **default preset is relaxed** for live 5m BNB: a **higher** `maxAtrPct` (~5.5%) so violent drops/spikes are not rejected as “too chaotic” as often, **chopLookback 4** (harder to count as choppy), and softer momentum / mirror / level vetoes than the original strict tuning — **more signals, more noise**.

- Choppy: last `chopLookback` candles alternate color every bar
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
- **Signal bar** (latest of the 3): body/range vs baseline (`MOMENTUM_BODY_VS_AVG`, `MOMENTUM_RANGE_VS_AVG`), strong close (`MIN_BODY_TO_RANGE`), close near directional extreme (`MAX_CLOSE_TO_EXTREME_PCT` — green: `(high-close)/range`; red: `(close-low)/range`).
- **Inner bars** (earlier two of the three): if `momentumAllowDojiInnerBars` and `body/range ≤ momentumDojiMaxBodyToRange`, only require **range ≥ momentumDojiMinRangeVsAvgMult ×** baseline avg range (still same color); else same rules as the signal bar.
- EMA filter:
  - Bullish momentum valid only if close > EMA20 -> signal `UP`
  - Bearish momentum valid only if close < EMA20 -> signal `DOWN`
- **Reconfirmation (longer lookback)** — applied after the short-window checks above pass (see **Reconfirmation** below). Momentum can still return `NONE` with reason `reconfirm: momentum … blocked`.

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
- Reversal **body** ≥ `exhaustionRevBodyVsBaselineMult` × average body of the pre-run baseline (not necessarily full 1× avg — small first counter bars after a grind)
- Weakening evidence required from run:
  - shrinking body and/or
  - increasing wick pressure on trend side
- If prior run was green -> signal `DOWN`
- If prior run was red -> signal `UP`
- **Reconfirmation:** if the exhaustion candidate fails level checks (near support for `DOWN`, near resistance for `UP`), evaluation **continues** to Mirror and Momentum instead of returning `NONE`.

### Setup C: Mirror Cases

- Weak red sequence followed by strong green close -> signal `UP`
  - Guard: require close to be near/above EMA20 (avoid dead-cat bounces below EMA)
  - Guard: skip Mirror UP for a short window after a large red dump candle (range vs ATR)
  - **Context (UP-only, `src/config.ts`):** `mirrorUpApplyChoppyVeto` rejects Mirror UP when the last `chopLookback` bars alternate color (even if global chop skip is off under relaxed mode). `mirrorUpMinEmaSlopeBars` / `mirrorUpMinEmaSlopePct` require EMA20 slope over N bars not to be below a floor. `mirrorUpBelowEmaLookback` / `mirrorUpMaxClosesBelowEma` veto when too many recent closes (excluding the last 3 bars) finished below EMA20 — persistent bearish structure. Defaults follow the 90d strict Mirror sweep unless you relax them.
  - **Reconfirmation:** green body must not exceed median / ATR spike caps (`mirrorMaxGreenBodyVsMedianMult`, `mirrorMaxGreenBodyAtrMult`); **no** near-resistance veto on Mirror UP (Momentum uses that filter).
- Strong red momentum can still emit `DOWN` as mirror when momentum-down exists but EMA filter blocks classic momentum condition — **same reconfirmation as Momentum DOWN** (impulse run + near support).

## Reconfirmation (implemented)

Rationale: [`learning/failure-cases/synthesis-2026-03.md`](learning/failure-cases/synthesis-2026-03.md).

After a **candidate** is identified, the engine re-checks wider context before emitting:

| Candidate | Extra checks |
|-----------|----------------|
| **Exhaustion** | Near support (for `DOWN`) or near resistance (for `UP`) — if fail, **fall through** to Mirror/Momentum. |
| **Mirror UP** | Spike filter: signal green body vs **median body of prior bars only** (last bar excluded from median) and vs ATR. |
| **Momentum UP** | Same-direction run length ≤ `momentumMaxImpulseRun` (micro opposite bodies ≤ `min(ATR×momentumMicroPauseBodyAtrMult, median×momentumMicroPauseBodyVsMedianMult)` do not reset the run); not testing resistance from below (prior swing highs over short/long lookbacks, excluding last candle). |
| **Momentum DOWN** | Same run-length cap; **≥ `momentumMaxSameDirBarsInWindow` red closes** in the last `momentumSameDirWindow` bars → skip (extended bearish context, case 4); near prior swing lows (case 2/5). |
| **Mirror DOWN** (fallback) | Same as Momentum DOWN. |

**Levels (conservative):** Buffer = `max(levelNearAtrMult × ATR, close × levelNearPricePct)` so small ATR does not miss a level. **Near support** if `abs(close − s)` or `abs(low − s)` ≤ buffer for either short/long swing low (last candle excluded from swing). **Near resistance** symmetric with swing highs and `high`. Prefer skipping when price sits in these zones.

## Setup Evaluation Priority

Evaluation order is fixed:

1. Skip filters
2. Exhaustion — if it matches **and** passes reconfirmation, emit; else if it matches but reconfirmation fails, **continue**
3. Mirror (weak red -> strong green) — if it matches **and** passes reconfirmation, emit
4. Momentum (+ EMA side filter) — if it matches **and** passes reconfirmation, emit
5. Mirror fallback for strong red momentum — if it matches **and** passes reconfirmation, emit
6. Otherwise `NONE`

## Signal Dispatch Rules

- Do not emit if strategy output is `NONE`
- Do not emit twice for the same candle open time
- Do not emit same direction back-to-back

## Alert and Logging Contract

- Telegram signal message includes:
  - Pair
  - Signal (`UP`/`DOWN`)
  - Setup (`Momentum`/`Exhaustion`/`Mirror`)
  - Candle open time in **GMT+7** (wall clock, `Asia/Ho_Chi_Minh`)
  - Price
  - Reason
  - **No** chart URL in the message body — use the **TradingView** and **Countdown** inline buttons (Countdown opens [PancakeSwap BNB prediction](https://pancakeswap.finance/prediction?token=BNB)); TradingView link includes `timezone=Asia/Ho_Chi_Minh` so the chart clock opens in **GMT+7** (same as signal timestamps)
  - The signal message body also includes one **Pancake BNB prediction** line (on-chain epoch, phase, and time to lock/close when applicable), fetched at send time alongside the buttons
  - Telegram `/livecountdown` reads the same on-chain round timestamps as that page (`PancakePredictionV2` on BSC); optional env `BSC_RPC_URL` overrides the default JSON-RPC endpoint
- Every emitted signal is appended to `logs/signals.jsonl` with timestamp and metadata
- Telegram `/backtest <days>` now defaults to the current split live lane model: **Exhaustion + Mirror** together, with setup-separated dispatcher memory. Add `exhaustion` (for example `/backtest 30 exhaustion`) for an Exhaustion-only diagnostic run.

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
- `momentumBodyVsAvg=0.56`
- `momentumRangeVsAvg=0.56`
- `momentumAllowDojiInnerBars=true`, `momentumDojiMaxBodyToRange=0.22`, `momentumDojiMinRangeVsAvgMult=0.26`
- `minBodyToRange=0.33`
- `maxCloseToExtremePct=0.48`
- `exhaustionRunMin=3`
- `exhaustionRevMinPrevRangeMult=0.2`
- `exhaustionRevMaxPrevRangeMult=2.0` (reversal may exceed prior bar’s range when the run ends in small greens)
- `exhaustionRevBodyVsBaselineMult=0.55`
- `exhaustionApplyLevelReconfirm=false`
- `chopLookback=4`
- `lowVolFactor=0.3`
- `lowVolCompare=20`
- `atrPeriod=14`
- `minAtrPct=0.00005`
- `maxAtrPct=0.055`
- `sidewaysEmaPct=0.0007`
- `mirrorMaxBelowEmaPct=0.01`
- `mirrorDumpAtrMult=4.5`
- `mirrorDumpLookback=2`
- `mirrorWeakRedBodyRangePct=0.62`
- Mirror UP context: `mirrorUpApplyChoppyVeto=false`, `mirrorUpMinEmaSlopeBars=6`, `mirrorUpMinEmaSlopePct=-0.003`, `mirrorUpBelowEmaLookback=10`, `mirrorUpMaxClosesBelowEma=5` (90d strict backtest sweep)
- `mirrorDownLightReconfirm=true`
- `momentumMicroPauseBodyAtrMult=0.35`
- `momentumMicroPauseBodyVsMedianMult=0.42`
- `momentumMaxImpulseRun=9`
- `levelLookbackShort=10`
- `levelLookbackLong=50`
- `levelNearAtrMult=0.24`
- `levelNearPricePct=0.00042`
- `momentumSameDirWindow=16`
- `momentumMaxSameDirBarsInWindow=11`
- `mirrorMaxGreenBodyAtrMult=4.2`
- `mirrorMaxGreenBodyVsMedianMult=7.0`
- `mirrorMedianBodyLookback=20`
- `dryRun=false`
- `bscRpcUrl` default `https://bsc-dataseed.binance.org` (override with `BSC_RPC_URL`)
- Optional env (secrets, not defaults): `BSC_WALLET_PRIVATE_KEY`, `PANCAKE_PREDICTION_BET_BNB` — on-chain Pancake bet on UP/DOWN tap (see **Human review**)

## Change Control

- Any change to strategy logic must update this file in the same PR/commit.
- If this file and implementation diverge, fix both immediately so behavior and documentation stay aligned.

# Implementation deep-dive: Pancake wallet flow, Telegram, `/fakesignal`, reports, and strategy tuning (2026-03-28)

This note records **how** several features were implemented in this repo, **why** certain bugs appeared, and **how** they were diagnosed. It is meant as a learning artifact: you can read it months later and still follow the data paths.

---

## 1. Context: what this bot is

- **Market data**: Binance **spot** klines over WebSocket (`subscribeKline`), with REST bootstrap (`fetchKlines`).
- **Strategy**: `src/strategy/engine.ts` evaluates closed candles → `UP` / `DOWN` / `NONE` + a **setup** (`Momentum`, `Exhaustion`, `Mirror`, `None`).
- **Dispatch**: `src/signal/dispatcher.ts` decides whether to **emit** an alert for that bar (dedupe rules differ for Mirror vs Momentum/Exhaustion).
- **Human layer**: After a real emit, the bot sends Telegram **pre-prediction** with UP/DOWN buttons; optional **PancakeSwap Prediction (BNB)** bets when wallet + stake are configured.
- **Stack**: TypeScript, **viem** for BSC reads/writes, **Telegraf** for Telegram, JSONL files under `logs/` for signals/predictions/placements.

Secrets live in `.env` (never committed). Strategy **numbers** live in `src/config.ts` (committed).

---

## 2. Wallet interaction (BSC EOA, viem)

### 2.1 Design choice: EOA only

Pancake’s `betBull` / `betBear` are plain contract calls paid with **msg.value** (BNB). The code comments state: **smart contract wallets cannot** call these the same way an EOA does without different architecture. So the bot expects a **64-byte hex private key** → standard Ethereum-style account on BSC.

### 2.2 Normalizing the key

`normalizeBscPrivateKey` in `src/pancakeswap/predictionBet.ts`:

- Accepts `0x` + 64 hex or 64 hex without prefix.
- Returns `null` if invalid → **no on-chain** actions (Telegram may still show dry-run text).

This centralizes validation so every path (placement command, pick callback, claim) uses the same rule.

### 2.3 Placing a bet (`placePancakeBnbPredictionBet`)

High-level steps (see `predictionBet.ts`):

1. Build **public** + **wallet** clients with `http(rpcUrl)` transport on **`bsc`** chain (viem/chains).
2. Read **`minBetAmount`** from the prediction contract; reject if stake below minimum.
3. **`readBettableEpochNow`**: read `currentEpoch`, read `rounds(epoch)`, use **chain block timestamp** (not laptop clock) and the same inequality Pancake uses for “betting open” (`isPancakeRoundBettableAt` from `predictionCountdown.ts`).
4. Re-read bettable epoch **immediately before** `writeContract` so the tx targets the epoch the chain will still accept.
5. `writeContract` on `betBull` or `betBear` with `value: valueWei`.
6. `waitForTransactionReceipt`.
7. Return `epoch`, `txHash`, `direction`, `walletAddress`, `valueWei`.

**Why re-check chain time**: Wall clock and Binance candle close are not the same as BSC block time. Betting “open” is defined on-chain; using **latest block timestamp** avoids submitting into a locked round.

### 2.4 Stake amounts

- **Real pre-prediction taps**: `PANCAKE_PREDICTION_BET_BNB` → parsed to wei in `config.ts` (`pancakePredictionBetWei`).
- **`/fakesignal` and `/placement`**: fixed **0.0015 BNB** (`PLACEMENT_TEST_BET_WEI` in `notify.ts`), passed as `betWeiOverride` so env stake does not apply.

The link from Telegram pick → `predictionId` / `signalId` for ledger is stored in **`PlacementSignalLink`** (`humanPick.ts`), including optional **`betWeiOverride`** for fake signals only.

---

## 3. Pancake prediction lifecycle in this codebase

### 3.1 Contract surface (simplified mental model)

The ABI in `predictionBet.ts` includes:

- `currentEpoch`, `rounds(epoch)`, `betBull` / `betBear`, `claim`, `claimable`, `refundable`, `ledger(epoch, user)`, `bufferSeconds`, etc.

**Epoch** identifies the round you bet on. Your success message (“Placed on … epoch 467769”) is that id.

### 3.2 After a successful bet: `registerPendingPancakeBet`

`src/pancakeswap/betTracker.ts` appends a row to **`logs/pancake-bets-pending.json`** (JSON array file):

- `placementId` (UUID), `signalId`, optional `predictionId`, `epoch`, `direction`, `betTxHash`, `valueWei`, `walletAddress`, `phase: "awaiting_result"`.

The **outcome poller** only knows what to watch because of this file.

**Bug we fixed**: Previously, if the same **epoch string** already existed in the array, registration **returned early** and did nothing. On-chain tx could still succeed → user saw “Bet placed successfully” but **no row** (or a stale row) → **poller never notified**. **Fix**: **upsert** — remove any row with the same `epoch`, then push the new row (with a console warning).

### 3.3 Outcome poller (`outcomePoller.ts`)

Every **~30s**:

1. If dry-run or no valid private key → return.
2. `listTrackedPancakeBets()` from disk.
3. For each row, `getPancakeRoundOutcome` (`predictionBet.ts`) classifies the round:
   - still running / awaiting oracle → no Telegram yet.
   - **won** → Telegram HTML + **Claim** inline button; `markPancakeBetAwaitingClaim`.
   - **lost** / **draw** → Telegram + `appendPancakePlacementSettlement` + `removePancakeBet`.
   - **refund_available** → similar to win path for claim UX.

`getPancakeRoundOutcome` uses:

- `rounds(epoch)` timestamps and `oracleCalled`.
- After close + buffer, `refundable` / `claimable` to distinguish win vs loss vs refund.

**Bug we fixed**: Poller was started only **after** `await b.launch()` in `startTelegramCommandListener`. If Telegraf startup was slow or failed before that line, **poller never started** → silence after the bet. **Fix**: call **`startPancakeOutcomePoller(sendTelegramText)` from `main.ts`** as soon as Telegram env is present and not dry-run, **in parallel** with starting the command listener; remove the duplicate start from the end of the listener.

### 3.4 Claim path (Telegram callback `pclaim:<epoch>`)

`notify.ts` handles the callback: loads row by epoch, runs `claimPancakePredictionEpochs`, updates ledger via `appendPancakePlacementSettlement`, removes pending row, sends HTML result.

### 3.5 Placement ledger (`placementLedger.ts`)

Settled rows append to **`logs/pancake-placements.jsonl`** (one JSON object per line). Includes BNB wei fields and optional **USDT approx** using Binance **BNBUSDT** spot price at settlement (`fetchBnbUsdtPrice` in `bnbPrice.ts`).

**Hardening**: Wrapped the whole append in **try/catch** so a failure writing the file or computing fields does not throw out of the poller and block `removePancakeBet` / duplicate Telegram sends.

### 3.6 Linking bets to predictions (`hasBetForPrediction.ts`)

Used at **candle resolution** in `main.ts` to decide `predictions.jsonl` **result**:

- Scan **pending** tracker for matching `predictionId`.
- Scan **ledger** JSONL for `predictionId` or legacy `signalId`-only rows.

This answers: “Did this signal actually get an on-chain bet recorded?” without coupling `main.ts` to Telegram timing.

---

## 4. Telegram architecture (where things run)

### 4.1 Two entry points

1. **`main.ts` kline callback**: real strategy emits → `logRuntime` can send Telegram (signal + pre-prediction HTML).
2. **`startTelegramCommandListener`**: Telegraf `/commands` and **callback_query** (picks, claim, reports).

`sendTelegramText` is the shared primitive; `logRuntime` optionally forwards HTML to it.

### 4.2 Pre-prediction pick → on-chain

Callback pattern `pick:<fromOpenTime>:U|D`:

1. `recordHumanPick` (in-memory + maps for `signalId` / `predictionId`).
2. `runConfiguredPancakeBet(direction, { betWeiOverride?, placementContext })`.
3. On success, `registerPendingPancakeBet` + outcome poller eventually completes the story.

### 4.3 `/fakesignal` (testing the full pipeline)

**Problem**: Testing Pancake + pre-prediction without waiting for the strategy to fire.

**Approach**:

- `injectedFakeSignal.ts`: module-level queue; `enqueueFakeSignalForNextTick(payload)`; `pullFakeSignalIfQueued()` at the **start** of the WS kline handler when `pendingPrediction` is null — so the **next** closed candle resolves against the same `pendingPrediction` machinery as live.
- `notify.ts`: `/fakesignal up|down` fetches last **closed** REST kline, builds `signalId` / `predictionId`, logs signal, registers human pick link with **0.0015 BNB** override, sends the **same two messages as live** (`formatSignalTelegramLog` + Pancake countdown snippet + chart buttons, then `formatPrePredictionTelegramLog` + buttons), then reminder pings.

**Reports**: `reportFilters.ts` + daily/weekly exclude **FakeSignal** from aggregates so paper tests do not distort P&amp;L stats.

---

## 5. Prediction logging redesign (post-prediction Telegram removed)

### 5.1 Product intent

- **No** second Telegram message on next-candle “resolution” (old `formatPostPredictionTelegramLog`).
- If user **bet**, **Pancake poller + claim** messages are the meaningful “outcome.”
- If user **did not** bet, still log a row for reporting but **do not** count it in candle win-rate — categorize as **Ignored**.

### 5.2 Implementation

- At resolve: `hasRecordedPancakeBetForPrediction(predictionId, signalId)`.
- `appendPredictionLog` with `result: "PLACEMENT" | "IGNORED"` (plus full `actual`, `expected`, `botExpected`, `humanPick` for audit).
- `predictionStats.ts`: `countsTowardCandlePredictionStats` excludes `IGNORED` and `PLACEMENT`; legacy `RIGHT`/`WRONG` rows still feed stats for old data.
- Daily/weekly: **Prediction resolution** section with counts; detail lines explain ignored vs placement.

### 5.3 Type updates

`PredictionLogRow.result` in `logger.ts` is a union including `IGNORED` and `PLACEMENT`.

---

## 6. Strategy “no signals on volatile chart” — diagnosis and fix

### 6.1 Symptom

User showed a **violent BNB** chart (crash, whipsaw) and asked why **no alerts**.

### 6.2 How we found the likely blockers

1. Read **`evaluate()` order** in `engine.ts`: **choppy** → **ATR band** → **low vol** → **sideways** → setups. Anything that returns `NONE` early prevents all setups.
2. **`atrOutOfBand`**: skips if `atr/close < minAtrPct` OR **`> maxAtrPct`**. Default was **`maxAtrPct = 0.03` (3%)**. On 5m BNB, sharp moves often push ATR/close above 3% → **entire engine silent** with reason `atr out of band`.
3. Momentum needs **3** aligned bars + baseline ratios + **EMA side** + **reconfirmation** (impulse length, same-direction window for DOWN, near support/resistance).
4. Mirror UP has **below-EMA** and **post-dump** guards — irrelevant for pure dump continuation but matters for bounce plays.

### 6.3 Solution (defaults in `config.ts`)

Relaxed preset (documented in `RULES.md`):

- Raised **`maxAtrPct`** (~5.5%).
- **`chopLookback` 4** (harder to count as choppy).
- Softer momentum body/range/extreme ratios; longer allowed impulse run and same-dir window for DOWN.
- **`exhaustionApplyLevelReconfirm: false`** (fewer exhaustion vetoes).
- Tighter “near level” buffers (fewer S/R blocks).
- Mirror guards slightly looser.

**Tests**: `strategy.engine.test.ts` updated — e.g. more greens for impulse block test; wilder synthetic series for “ATR too high.”

### 6.4 Tradeoff

More signals ⇒ **more noise** and worse historical quality unless you tune per instrument. The right long-term pattern is often **env-specific overrides** or a **strict/relaxed** preset switch — not done here, but easy to add later.

---

## 7. Debugging methodology (reusable)

1. **Trace the user-visible symptom to a code path**  
   Example: “No loss Telegram” → search `lost` / `outcomePoller` / `registerPendingPancakeBet`.

2. **Follow data ownership**  
   Poller reads **disk** (`pancake-bets-pending.json`). If the row is missing, fix registration, not RPC.

3. **Order of startup**  
   Async bugs: “X only runs after Y” → list `main.ts` and listener entry; move critical loops to **deterministic** boot when possible.

4. **Silent failures**  
   Early `return` without log (duplicate epoch) → add **warn** + **upsert**.

5. **Grep + read callers**  
   `grep -r registerPendingPancakeBet`, `grep appendPredictionLog`, etc.

6. **Keep RULES.md in sync**  
   This repo treats `RULES.md` as behavioral source of truth; config changes should update the **Config Defaults** section.

---

## 8. File map (quick reference)

| Area | Main files |
|------|------------|
| Config / secrets loading | `src/config.ts`, `.env`, `env.example` |
| Strategy | `src/strategy/engine.ts`, `src/strategy/indicators.ts` |
| Dispatch | `src/signal/dispatcher.ts` |
| Main loop / prediction resolve | `src/main.ts` |
| Logging | `src/logger.ts` |
| Telegram | `src/telegram/notify.ts`, `src/logging/runtime.ts` |
| Human pick state | `src/prediction/humanPick.ts` |
| Fake signal injection | `src/prediction/injectedFakeSignal.ts` |
| On-chain bet + outcome reads | `src/pancakeswap/predictionBet.ts`, `predictionCountdown.ts` |
| Pending bets | `src/pancakeswap/betTracker.ts` |
| Poller | `src/pancakeswap/outcomePoller.ts` |
| Ledger | `src/pancakeswap/placementLedger.ts` |
| Bet detection for logs | `src/pancakeswap/hasBetForPrediction.ts` |
| Reports | `src/report/daily.ts`, `weekly.ts`, `predictionStats.ts`, `reportFilters.ts`, `pancakePlacementReport.ts` |
| Docs | `RULES.md` |

---

## 9. Security reminders (wallet)

- **Hot wallet only**, limited BNB, key only in `.env` on the server.
- Never commit keys; rotate if leaked.
- RPC URL is not secret but affects reliability — use a decent BSC endpoint under load.

---

## 10. Optional next steps (not implemented)

- Preset switch: `STRICT_PRESET=1` vs relaxed defaults.
- Metrics: count skip reasons per day from logs.
- Stronger race handling: if bet confirms **after** candle resolution, optional second pass to flip `IGNORED` → `PLACEMENT` (would need ledger reconciliation).

---

*Written as a learning summary of work done around Pancake integration, Telegram, testing hooks, reporting, poller reliability, and strategy tuning.*

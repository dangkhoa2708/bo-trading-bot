# BNB/USDT 5m Signal Bot

Rule-based trading signal bot for `BNBUSDT` on `5m` candles.

- Receives closed candles from Binance
- Evaluates momentum/exhaustion/mirror setups
- Emits `UP` / `DOWN` / `NONE`
- Sends Telegram alerts (or dry-run console logs)
- Logs all emitted signals to `logs/signals.jsonl`

## Source of Truth

Strategy behavior and constraints are defined in `RULES.md`.

- Read `RULES.md` first for setup logic and skip conditions
- If code and docs diverge, update both in the same change

## Current Scope

- Binance spot signals only (no Binance order execution)
- Optional: UP/DOWN on pre-prediction can place a **PancakeSwap BNB prediction** on BSC if you set `BSC_WALLET_PRIVATE_KEY` + `PANCAKE_PREDICTION_BET_BNB` in `.env` (see `RULES.md` — use a hot wallet, never commit keys)
- Single pair default: `BNBUSDT`
- Single timeframe: `5m`

## Tech Stack

- Node.js + TypeScript
- Binance REST + WebSocket
- Telegram Bot API via `telegraf`

## Project Structure

- `src/main.ts` - app entrypoint and runtime flow
- `src/config.ts` - code + env configuration
- `src/binance/rest.ts` - startup candle bootstrap
- `src/binance/candleStream.ts` - live closed-candle stream
- `src/strategy/engine.ts` - setup and skip logic
- `src/strategy/indicators.ts` - EMA/body/range helpers
- `src/signal/dispatcher.ts` - duplicate signal guard
- `src/telegram/notify.ts` - Telegram alert sender
- `src/logger.ts` - jsonl signal logger
- `RULES.md` - strategy source of truth
- `env.example` - Telegram env template

## Prerequisites

- Node.js 18+
- npm
- Telegram bot token and chat id (for real alerts)

## Quick Start

1) Install dependencies

```bash
npm install
```

2) Create your environment file

```bash
cp env.example .env
```

3) Set Telegram values in `.env`:

- `TELEGRAM_BOT_TOKEN=...`
- `TELEGRAM_CHAT_ID=...`

4) Start in dry run mode (default, controlled in `src/config.ts`)

```bash
npm run dev
```

## Run Modes

- `src/config.ts`: `dryRun: true` -> no Telegram send, prints alert payload to console
- `src/config.ts`: `dryRun: false` -> sends actual Telegram messages

Recommended rollout:

1. Keep `dryRun: true`
2. Observe logs/signals for at least several sessions
3. Enable Telegram only after confidence check

## Scripts

- `npm run dev` - watch mode with `tsx`
- `npm run build` - compile TypeScript to `dist/`
- `npm run start` - run compiled app
- `npm run report:today` - show today's signal counts from `logs/signals.jsonl` (GMT+7)
- `npm run report:week` - show last 7 days signal/prediction report (GMT+7)
- `npm run test` - run unit tests once
- `npm run test:watch` - run tests in watch mode

Telegram command:

- `/dailyreport` - reply with today's report (signals + predictions) for the configured chat
- `/weeklyreport` - reply with last 7 days report (signals + predictions) for the configured chat
- `/backtest` — replay the last **3** days of closed klines (ending now) through the same engine + dispatcher as live.
- `/backtest 7` — last **7** days (max **90**). Binance returns max 1000 candles per request; the client paginates for longer ranges.
- `/placement up` / `/placement down` — same next-epoch Pancake path as UP/DOWN tap; fixed **0.003 BNB** test stake (only needs wallet key in `.env`, not `PANCAKE_PREDICTION_BET_BNB`); ✅/❌ reply.

## Configuration

- Strategy/runtime settings live in `src/config.ts`
- `.env` controls Telegram secrets only (start from `env.example`)

Most useful knobs:

- `MOMENTUM_BODY_VS_AVG` - strictness of momentum candle size
- `MOMENTUM_RANGE_VS_AVG` - strictness of momentum candle range expansion
- `MIN_BODY_TO_RANGE` - strictness of strong close
- `MAX_CLOSE_TO_EXTREME_PCT` - requires close near candle high/low in trend direction
- `EXHAUSTION_REV_MIN_PREV_RANGE_MULT` / `EXHAUSTION_REV_MAX_PREV_RANGE_MULT` - keep exhaustion reversal size in a healthy band vs previous candle
- `CHOP_LOOKBACK` - sensitivity to alternating/choppy candles
- `LOW_VOL_FACTOR` - low-volatility filter sensitivity
- `ATR_PERIOD` - lookback for ATR volatility
- `MIN_ATR_PCT` / `MAX_ATR_PCT` - skip too-quiet or too-chaotic volatility
- `SIDEWAYS_EMA_PCT` - sideways tolerance around EMA

## Runtime Flow

1. Bootstrap recent candles from Binance REST
2. Subscribe to Binance 5m kline stream
3. Process only closed candles
4. Run strategy engine
5. Apply dispatch dedupe guard
6. Emit alert + append signal log

## Logging

Output file: `logs/signals.jsonl`

Each line includes:

- signal id (link key between signal and prediction)
- timestamp
- candle open time
- close price
- signal
- setup type
- reason

## Troubleshooting

- `npm: command not found`
  - install Node.js and ensure `npm` is on PATH
- no alerts sent
  - confirm `.env` exists and `DRY_RUN=0`
  - verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
- bot starts but no signals
  - this can be valid; skip conditions may filter noisy market
  - inspect console reasons and `RULES.md`

## Pull VPS Logs

Helper scripts (from project root):

```bash
VPS_IP=<VPS_IP> scripts/pull-vps-logs.sh
VPS_IP=<VPS_IP> scripts/tail-vps-logs.sh
```

Optional vars:

- `VPS_USER` (default `bot`)
- `REMOTE_DIR` for pull script (default `~/bo-trading-bot/logs`)
- `REMOTE_FILE` for tail script (default `~/bo-trading-bot/logs/signals.jsonl`)
- `LOCAL_DIR` for pull script (default `./logs-vps`)

Manual commands:

From your local machine, pull runtime logs from VPS:

```bash
mkdir -p ./logs-vps
scp bot@<VPS_IP>:~/bo-trading-bot/logs/*.jsonl ./logs-vps/
```

Or use `rsync` (safer for repeated syncs):

```bash
mkdir -p ./logs-vps
rsync -avz bot@<VPS_IP>:~/bo-trading-bot/logs/ ./logs-vps/
```

Quick live view directly on VPS:

```bash
ssh bot@<VPS_IP> 'tail -f ~/bo-trading-bot/logs/signals.jsonl'
```

## Safety Note

This project emits signals only. It does not place live orders.
Keep risk controls and manual validation as mandatory before any future automation.

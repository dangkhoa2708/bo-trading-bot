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

- Signal bot only (no auto-execution)
- Single pair default: `BNBUSDT`
- Single timeframe: `5m`

## Tech Stack

- Node.js + TypeScript
- Binance REST + WebSocket
- Telegram Bot API via `telegraf`

## Project Structure

- `src/main.ts` - app entrypoint and runtime flow
- `src/config.ts` - env-driven configuration
- `src/binance/rest.ts` - startup candle bootstrap
- `src/binance/candleStream.ts` - live closed-candle stream
- `src/strategy/engine.ts` - setup and skip logic
- `src/strategy/indicators.ts` - EMA/body/range helpers
- `src/signal/dispatcher.ts` - duplicate signal guard
- `src/telegram/notify.ts` - Telegram alert sender
- `src/logger.ts` - jsonl signal logger
- `RULES.md` - strategy source of truth
- `env.example` - default config template

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

4) Start in dry run mode (default)

```bash
npm run dev
```

## Run Modes

- `DRY_RUN=1` -> no Telegram send, prints alert payload to console
- `DRY_RUN=0` -> sends actual Telegram messages

Recommended rollout:

1. Keep `DRY_RUN=1`
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

## Configuration

See `env.example` for defaults.

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

## Safety Note

This project emits signals only. It does not place live orders.
Keep risk controls and manual validation as mandatory before any future automation.

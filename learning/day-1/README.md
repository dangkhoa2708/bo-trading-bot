# Day 1 - Backend Basics for This Bot

This note explains the technology used in this project so far, in simple terms.

## What is `tsx watch`?

`tsx` is a tool that runs TypeScript files directly in Node.js (without manual compile first).

`tsx watch src/main.ts` means:

- start your app from `src/main.ts`
- watch your files for changes
- auto-restart the app whenever you save

So during development, you do not need to run build manually every time.

## Commands You Use

- `npm run dev` -> runs `tsx watch src/main.ts` (best for development)
- `npm run test` -> runs unit tests with Vitest
- `npm run build` -> compiles TypeScript to `dist/`
- `npm run start` -> runs built JS from `dist/main.js`

## Technology Stack (Used So Far)

## 1) Node.js

- Runtime that executes JavaScript/TypeScript on server side
- Think of it as the engine running your bot process

## 2) TypeScript

- JavaScript with types
- Helps catch mistakes early (`signal` should be `UP | DOWN | NONE`, etc.)

## 3) npm

- Package manager
- Installs libraries like `ws`, `telegraf`, `dotenv`, `vitest`

## 4) `ws` (WebSocket client)

- Used to connect to Binance kline stream in real time
- We only process closed candles (`k.x = true`)

## 5) Binance REST + WebSocket

- REST (`src/binance/rest.ts`): fetch initial history (last 50 candles)
- WebSocket (`src/binance/candleStream.ts`): receive new closed 5m candles continuously

## 6) Strategy Engine

- File: `src/strategy/engine.ts`
- Decides signal based on rules:
  - Momentum
  - Exhaustion
  - Mirror
  - Skip filters (choppy / low-vol / sideways)

## 7) Signal Dispatcher

- File: `src/signal/dispatcher.ts`
- Prevents duplicate alerts:
  - same candle
  - same direction back-to-back

## 8) Telegram (`telegraf`)

- File: `src/telegram/notify.ts`
- Sends alerts to chat when `DRY_RUN=0`
- In dry run, it prints payload instead of sending

## 9) Logging

- File: `src/logger.ts`
- Appends emitted signals to `logs/signals.jsonl`
- Useful for review and later analytics

## 10) Environment config (`dotenv`)

- `src/config.ts` loads variables from `.env`
- Keeps secrets and tuning values out of code

Examples:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `MOMENTUM_BODY_VS_AVG`

## 11) Testing with Vitest

- Tests are in `tests/`
- Fast and TypeScript-friendly for ESM projects
- Current tests cover:
  - strategy outcomes
  - dispatch dedupe behavior

## Request/Flow Mental Model

Every 5-minute closed candle:

1. Candle arrives from Binance stream
2. App updates local rolling candle list
3. Strategy evaluates signal
4. Dispatcher checks if safe to emit (no duplicates)
5. If emit:
   - log to file
   - send Telegram (or dry-run print)

## Files to Read First (Beginner Order)

1. `src/types.ts`
2. `src/config.ts`
3. `src/main.ts`
4. `src/strategy/indicators.ts`
5. `src/strategy/engine.ts`
6. `src/signal/dispatcher.ts`
7. `src/telegram/notify.ts`
8. `RULES.md`

## Local Practice Checklist

- [ ] Run `npm run dev`
- [ ] Wait for a closed 5m candle
- [ ] Observe `[verify] ...` output
- [ ] Run `npm run test`
- [ ] Open `logs/signals.jsonl` after signal appears

## Vocabulary Quick Guide

- **Backend**: code running as a process/service (not UI)
- **Runtime**: where code executes (Node.js)
- **WebSocket**: always-on connection for real-time events
- **REST API**: request/response endpoint for historical data
- **Env vars**: external config values loaded from `.env`
- **Unit test**: small test for one module/function behavior

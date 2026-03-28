# Day 2 - VPS Deployment Basics (SSH, users, PM2)

**Related:** [Pancake wallet, Telegram, `/fakesignal`, reports & strategy tuning (implementation deep-dive)](./pancake-wallet-telegram-strategy-2026-03-28.md) — how on-chain bets, the outcome poller, prediction logging, and relaxed 5m defaults were built and debugged.

This note explains the deployment concepts you’re using to run this trading bot on a VPS 24/7.

The goal: **your bot keeps running even when you close your laptop and disconnect SSH**.

## What is a VPS?

A **VPS** (Virtual Private Server) is a Linux machine in the cloud.

- It has an IP address (example: `178.128.92.248`)
- You can SSH into it (remote terminal)
- You can run your bot as a long-running process

## SSH: how you “enter” the VPS

From your laptop:

```bash
ssh root@178.128.92.248
```

Or if your server user is `bot`:

```bash
ssh bot@178.128.92.248
```

If you used an SSH key file:

```bash
ssh -i ~/.ssh/<your_key> bot@178.128.92.248
```

### Basic SSH mental model

- SSH is just a remote terminal session.
- Closing SSH **does not stop** your bot if it is managed by a process manager like PM2.

## Linux users: why `root` vs `bot` matters

- **`root`**: the admin user. Can do anything. Dangerous if you do daily work as root.
- **`bot`**: a normal user, safer for running apps.

Your project is under:

- `/home/bot/bo-trading-bot`

So if you SSH as `root`, you often switch to user `bot` for app commands.

## `su - bot`: what it means

```bash
su - bot
```

- `su` = “switch user”
- `-` = “login shell”

The `-` is important: it loads the target user’s environment properly and sets the home directory.

After running `su - bot`:

- `~` becomes `/home/bot`
- your commands now run as the `bot` user

To go back to root:

```bash
exit
```

## Node/npm on VPS

This bot is a Node.js app.

Typical commands:

- `npm install` installs dependencies
- `npm run build` compiles TypeScript into `dist/`
- `npm run start` runs `dist/main.js`

## Why we run `npm run build` on VPS

In production (VPS), we usually run the compiled output:

- build once -> `dist/`
- run stable JS -> `npm run start`

This is more stable than `npm run dev` (watch mode), and uses less CPU.

## PM2: keep the bot alive forever

PM2 is a process manager for Node.js apps.

PM2 gives you:

- bot continues running after SSH disconnect
- auto-restart if your bot crashes
- `pm2 logs` to see output

### The 2 PM2 “persistence layers” (very important)

PM2 has two separate things people often confuse:

1) **PM2 is running right now** (in memory)
- If you `pm2 start ...`, it starts immediately and shows up in `pm2 list`.
- If you reboot the VPS, this in-memory list is gone **unless** you set up startup restore.

2) **Saved process list** (on disk)
- `pm2 save` writes the current PM2 process list to a dump file (roughly: “these are the apps PM2 should restore later”).
- Without `pm2 save`, PM2 can’t reliably restore your bot after reboot.

So:

- **use `pm2 save` after you create/delete/rename processes**
- **you don’t need `pm2 save` after every restart**

### `pm2 startup`: why it exists

`pm2 startup` configures your VPS to run PM2 automatically on boot.

Then on boot, PM2 can restore the apps you previously saved via `pm2 save`.

Typical one-time setup:

```bash
su - bot
pm2 startup
# PM2 will print a command starting with "sudo ...".
# Copy/paste that exact command.
pm2 save
```

### Useful PM2 commands

List processes:

```bash
pm2 list
```

View logs:

```bash
pm2 logs bo-trading-bot --lines 100
pm2 logs bo-trading-bot --err --lines 100
```

Restart (and reload `.env` values):

```bash
pm2 restart bo-trading-bot --update-env
```

Stop / delete:

```bash
pm2 stop bo-trading-bot
pm2 delete bo-trading-bot
```

Save current PM2 process list (important):

```bash
pm2 save
```

#### What `pm2 save` does (simple)

It saves your current PM2 process list so that:

- after reboot, PM2 can restore the same apps
- you don’t have to “pm2 start ...” manually again

If you skip it, after reboot you may see:

- `pm2 list` is empty
- your bot is not running

## “Killed it before” → how to run again (copy/paste)

If you previously stopped/deleted the process, do this:

```bash
su - bot
cd ~/bo-trading-bot
git pull origin main
npm install
npm run build
pm2 start npm --name bo-trading-bot -- run start
pm2 save
pm2 logs bo-trading-bot --lines 100
```

If the PM2 process exists already, you only need:

```bash
su - bot
pm2 restart bo-trading-bot --update-env
pm2 logs bo-trading-bot --lines 100
```

## `.env`: what is it for in this repo?

We keep `.env` for **secrets only**:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Never commit `.env` to GitHub.

If you edited `.env`, use:

```bash
pm2 restart bo-trading-bot --update-env
```

### Why `--update-env` matters

PM2 can cache environment variables from when the process was started.
If you change `.env` and only run `pm2 restart` without `--update-env`,
PM2 might restart using old environment values.

So the rule:

- changed `.env` => restart with `--update-env`
- changed code only => normal restart is fine

## Health checking the bot (Telegram)

The bot supports:

- `/status` → shows server health (uptime, websocket connected, Telegram/Binance reachability)

If Telegram sending is flaky, one common fix is to force IPv4-first:

```bash
pm2 restart bo-trading-bot --update-env --node-args="--dns-result-order=ipv4first"
```

## Common troubleshooting

### 1) “Process not found”

You’re restarting a name that doesn’t exist:

```bash
pm2 list
```

Copy the exact name from the list.

### 2) “Cannot find dist/main.js”

You forgot to build:

```bash
cd ~/bo-trading-bot
npm run build
pm2 restart bo-trading-bot
```

### 3) Telegram timeouts (`ETIMEDOUT`)

Check Telegram API reachability:

```bash
curl --max-time 10 "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe"
```

If it’s intermittent, prefer IPv4-first restart (see above).

### 4) Permission issues as root vs bot

If you installed Node packages as root, file ownership might be wrong.
Prefer:

- app work as `bot`
- admin work as `root`

You can check who owns files:

```bash
ls -la ~/bo-trading-bot
```

## Glossary

- **SSH**: remote terminal connection to the VPS
- **root**: admin user
- **su - bot**: switch to `bot` user with proper environment
- **PM2**: keeps your Node process running 24/7 and restarts it on crashes
- **build**: compile TS -> `dist/`
- **start**: run compiled JS


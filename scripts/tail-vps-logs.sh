#!/usr/bin/env bash
set -euo pipefail

VPS_IP="${VPS_IP:-}"
VPS_USER="${VPS_USER:-bot}"
REMOTE_FILE="${REMOTE_FILE:-~/bo-trading-bot/logs/signals.jsonl}"

if [[ -z "$VPS_IP" ]]; then
  echo "Missing VPS_IP env var. Example: VPS_IP=178.128.92.248 scripts/tail-vps-logs.sh"
  exit 1
fi

ssh "${VPS_USER}@${VPS_IP}" "tail -f ${REMOTE_FILE}"

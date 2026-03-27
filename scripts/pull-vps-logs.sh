#!/usr/bin/env bash
set -euo pipefail

VPS_IP="${VPS_IP:-}"
VPS_USER="${VPS_USER:-bot}"
REMOTE_DIR="${REMOTE_DIR:-~/bo-trading-bot/logs}"
LOCAL_DIR="${LOCAL_DIR:-./logs-vps}"

if [[ -z "$VPS_IP" ]]; then
  echo "Missing VPS_IP env var. Example: VPS_IP=178.128.92.248 scripts/pull-vps-logs.sh"
  exit 1
fi

mkdir -p "$LOCAL_DIR"
rsync -avz "${VPS_USER}@${VPS_IP}:${REMOTE_DIR}/" "$LOCAL_DIR/"

echo "Synced VPS logs to $LOCAL_DIR"

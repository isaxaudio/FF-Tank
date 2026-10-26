#!/bin/sh
# One sequence-scheduler tick against FF Tank: POST /api/index?service=sequence-run with CRON_SECRET.
# Runs every 15 minutes from a LaunchAgent on the Mac mini (scripts/install-sequence-tick.sh) or from
# any cron:  */15 * * * *  /path/to/sequence-tick.sh
# Reads CRON_SECRET from the project's .env.local (never printed). Logs one line per run.
set -eu
DIR="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${FF_TANK_URL:-https://ff-tank.vercel.app}"
SECRET="${CRON_SECRET:-$(grep -E '^CRON_SECRET=' "$DIR/.env.local" | head -1 | cut -d= -f2- | tr -d "\"'")}"
LOG="${HOME}/Library/Logs/ff-tank-sequence-tick.log"
if [ -z "$SECRET" ]; then echo "$(date -u +%FT%TZ) no CRON_SECRET" >> "$LOG"; exit 1; fi
OUT=$(curl -sS -m 60 -X POST -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" -d '{}' "$BASE/api/index?service=sequence-run" 2>&1 || true)
echo "$(date -u +%FT%TZ) $(printf '%s' "$OUT" | tr -d '\n' | cut -c1-300)" >> "$LOG"

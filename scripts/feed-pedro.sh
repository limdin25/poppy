#!/usr/bin/env bash
# One command: take whatever the floorplan reader has confirmed since last time,
# price it, and put it on Pedro's screen. Safe to run as often as you like.
#
# Hugo, 2026-08-12: "You don't need to do 2000 in one go. Just give him 50, more
# 50. You don't have to do everything."
#
# So this is the drip, not a big-bang rebuild. Each step is a no-op when there is
# nothing new:
#   1. fetch sold prices of 4 and 5 bed houses near anything newly confirmed
#   2. re-price the whole confirmed set (cheap, pure arithmetic, no API calls)
#   3. push up to --limit NEW properties, skipping everything already in the CRM
#   4. rebuild the branch dialer queue
#
# The floorplan reader itself runs separately and continuously on the VPS:
#   second_room.py --pool        houses whose kitchen already passed
#   second_room.py --no-kitchen  houses where it did not, needing +2 elsewhere
#   second_room.py --unread      plans we hold but have never read
#
# Everything reads floor plans on the CHEAP model via OpenRouter. Gemini is not
# used anywhere in this path, per Hugo 2026-08-12.
#
#   ./scripts/feed-pedro.sh            # 50 at a time, the default
#   ./scripts/feed-pedro.sh 25         # smaller batch
set -euo pipefail

LIMIT="${1:-50}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VPS="margarita-server"

echo "=== 1. sold prices for anything newly confirmed ==="
ssh -o ConnectTimeout=30 "$VPS" \
  'cd /root/scraper && set -a && . ./.env && set +a && .venv/bin/python -u refetch_plus2.py 2>&1 | tail -5'

echo
echo "=== 2. price them ==="
ssh -o ConnectTimeout=60 "$VPS" \
  'cd /root/scraper && .venv/bin/python build_pedro_list.py 2>&1 | head -7'

echo
echo "=== 3. push up to $LIMIT new ones to Pedro ==="
scp -q -o ConnectTimeout=30 \
  "$VPS":/root/scraper/exports/pedro_priced_list.json "$REPO"/
cd "$REPO"
node scripts/push-priced-properties-to-pedro.mjs --limit="$LIMIT" --apply | head -6

echo
echo "=== 4. rebuild his branch queue ==="
node scripts/assign-properties-to-pedro-houses.mjs --refresh --apply | tail -4

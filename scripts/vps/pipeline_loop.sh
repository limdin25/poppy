#!/bin/bash
# Run the whole property pipeline every 20 minutes while the floor plan fetch
# is still going, so branches accumulate through the night instead of arriving
# in one lump at the end.
#
# Each stage is resumable and skips what it has already done, which is what
# makes re-running safe: scoring skips scored plans (and so never pays twice),
# the postcode backfill skips addresses that already carry one, the comps fetch
# only takes properties with none, and the ingest upserts.
cd /root/scraper || exit 1
export GOOGLE_GEOCODE_KEY="$1"
LOG=/tmp/pipeline_loop.log

for round in $(seq 1 14); do
  echo "=== round $round  $(date +%H:%M) ===" >> $LOG
  .venv/bin/python score_floorplans.py all >> $LOG 2>&1

  # Anything the reader says can gain a bedroom, is not vetoed, has a phone and
  # is not an auction goes into the shortlist. The engine's pursue gate is still
  # the real filter downstream: nothing reaches Pedro unless the deal stacks.
  .venv/bin/python - >> $LOG 2>&1 <<'PYEOF'
import sqlite3, datetime, sys
sys.path.insert(0,'/root/scraper'); import env_loader
con = sqlite3.connect('/root/scraper/data/scraper.db'); cur = con.cursor()
rows = cur.execute('''SELECT l.property_id FROM rm_listings l
    JOIN rm_floorplan_ai a ON a.property_id = l.property_id
    LEFT JOIN rm_reviews r ON r.property_id = l.property_id
   WHERE a.can_add_bedroom = 1 AND COALESCE(a.vetoed,'') = '' AND r.property_id IS NULL
     AND l.agent_phone IS NOT NULL AND l.agent_phone != ''
     AND COALESCE(l.is_auction,'') != '1' ''').fetchall()
now = datetime.datetime.now().isoformat(timespec='seconds')
cur.executemany('INSERT INTO rm_reviews (property_id, status, reviewed_at) VALUES (?, "potential", ?)',
                [(r[0], now) for r in rows])
con.commit(); print(f'marked potential: {len(rows)}')
PYEOF

  .venv/bin/python backfill_postcodes.py >> $LOG 2>&1
  .venv/bin/python fast_comps.py         >> $LOG 2>&1
  .venv/bin/python send_to_elsie.py --apply >> $LOG 2>&1
  echo "--- round $round done $(date +%H:%M) ---" >> $LOG
  sleep 1200
done
echo "PIPELINE LOOP FINISHED $(date +%H:%M)" >> $LOG

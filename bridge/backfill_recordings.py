"""Push recordings and transcripts already on disk up to the CRM.

    python3 -m bridge.backfill_recordings            # say what it would do
    python3 -m bridge.backfill_recordings --apply    # upload

Every call before 2026-07-29 left its WAV and its transcript on the VPS and
nowhere else, because the upload did not exist yet. This walks the transcripts
directory and attaches each one to its ledger row.

Matching is by PHONE NUMBER, taken from the filename, which is how
save_transcript names them: 20260729-163920-+14254221365.json. A number that
was called twice would be ambiguous, but it cannot happen: the ledger's primary
key is the phone number, so one number is one call, for ever.

Safe to re-run. Uploads use x-upsert, and attaching is an idempotent PATCH.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from . import dialqueue

TRANSCRIPTS = Path(__file__).resolve().parent / "transcripts"
NUMBER = re.compile(r"(\+\d{7,15})")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Backfill call recordings to the CRM.")
    p.add_argument("--apply", action="store_true", help="actually upload")
    p.add_argument("--dir", default=str(TRANSCRIPTS))
    args = p.parse_args(argv)

    root = Path(args.dir)
    files = sorted(root.glob("*.json"))
    print(f"{len(files)} transcript(s) in {root}")

    done = skipped = failed = 0
    for js in files:
        m = NUMBER.search(js.name)
        if not m:
            skipped += 1
            continue
        e164 = m.group(1)
        wav = js.with_suffix(".wav")
        try:
            turns = json.loads(js.read_text()).get("turns")
        except Exception as e:
            print(f"  unreadable {js.name}: {e}")
            failed += 1
            continue

        if not args.apply:
            print(f"  would attach {e164:<15} "
                  f"{len(turns or []):>2} turns  {'+wav' if wav.exists() else 'no wav'}")
            done += 1
            continue

        obj = dialqueue.upload_recording(wav, e164) if wav.exists() else None
        dialqueue.attach_recording(e164, obj, turns)
        done += 1
        print(f"  {e164:<15} {len(turns or []):>2} turns  {obj or '(no audio)'}")

    print(f"\n{done} attached, {skipped} without a number in the name, {failed} unreadable")
    if not args.apply:
        print("DRY RUN. Nothing uploaded. Add --apply.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

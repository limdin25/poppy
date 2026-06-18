"""One-off: recompose + SEND the OpenRent reply-draft backlog through the brain
(now pitch-per-lead). For each OpenRent conversation with a pending AI draft, ask
the app to re-draft on the LATEST thread state (older tenant-style-opener leads now
get the full pitch; already-pitched leads get a short nudge; a since-shared number
becomes a handoff), then flip the draft -> queued so the worker sends it.

WhatsApp drafts are NEVER touched (only channel='openrent' conversations).

  .venv/bin/python send_openrent_backlog.py [--limit N]            # DRY (show, no send)
  .venv/bin/python send_openrent_backlog.py --apply [--limit N]     # update drafts -> queued
"""
import random
import sys
import time

import llm
from worker import load_config
from db import DB


def main():
    apply = "--apply" in sys.argv
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    cfg = load_config()
    db = DB(cfg)

    convs = db.sb.table("conversations").select("id").eq("channel", "openrent").execute().data or []
    or_ids = {c["id"] for c in convs}
    drafts = (db.sb.table("messages").select("id,conversation_id,body,created_at")
              .eq("status", "draft").eq("direction", "outbound")
              .order("created_at").execute().data or [])
    backlog = [d for d in drafts if d["conversation_id"] in or_ids]
    if limit:
        backlog = backlog[:limit]
    print(f"OpenRent draft backlog: {len(backlog)} conversation(s)  [{'APPLY' if apply else 'DRY'}]\n")

    queued = handoff = errs = 0
    for d in backlog:
        conv_id = d["conversation_id"]
        res = llm.draft_reply(cfg, [], conversation_id=conv_id)
        if res.get("skip") or res.get("handoff"):
            handoff += 1
            print(f"  {conv_id[:8]} HANDOFF (number shared since) — leaving OpenRent draft, WhatsApp draft built")
            continue
        text = (res.get("text") or "").strip()
        stage = res.get("stage") or "?"
        if not text:
            errs += 1
            print(f"  {conv_id[:8]} ERROR no text: {res}")
            continue
        print(f"  {conv_id[:8]} [{stage}] {text[:110].replace(chr(10), ' / ')}")
        if apply:
            db.sb.table("messages").update({"body": text, "status": "queued"}).eq("id", d["id"]).execute()
            queued += 1
        time.sleep(random.uniform(1.2, 2.5))

    print(f"\nDONE: {'queued' if apply else 'would-queue'}={queued if apply else len(backlog) - handoff - errs}"
          f"  handoff={handoff}  errors={errs}  of {len(backlog)}")


if __name__ == "__main__":
    main()

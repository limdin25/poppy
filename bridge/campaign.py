"""Work a dial queue in batches, one batch at a time.

    python3 -m bridge.campaign --batch 10                 # dry, shows who it would ring
    python3 -m bridge.campaign --batch 10 --apply         # rings them
    python3 -m bridge.campaign --batch 10 --apply --batches 3

Hugo, 2026-07-29: "if simultanious call is a thing you can do it like batches
of 10 mak sure its good then next."

That is the right instinct and it is the shape of this runner. It dials a
batch, WAITS for every call in it to finish, prints what happened, and then
stops unless it was told to do more. The pause between batches is the point:
it is where a human decides whether the last ten went well enough to justify
the next ten. A runner that streamed a hundred calls without a break would
turn one bad prompt into a hundred bad phone calls before anyone noticed.

DRY BY DEFAULT. Without --apply nothing is claimed and nobody is rung.

WHY IT DOES NOT CLAIM THE WHOLE HUNDRED UP FRONT: claiming writes the ledger,
and the ledger is final. Claim ten, ring ten. If the process dies, nine
unclaimed batches are untouched and still callable, instead of ninety numbers
marked as rung that nobody ever rang.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

from . import config, dialqueue

DEFAULT_CAMPAIGN = "USA Plumbers - Maria"

# A call that has not finished after this long is presumed lost, so the batch
# stops waiting for it. MAX_CALL_SECONDS bounds the conversation itself; this
# has to be comfortably longer, because it also covers ringing and teardown.
BATCH_TIMEOUT_S = 420

# Telnyx dials as fast as it is asked to. Ten calls launched in the same
# millisecond is a burst pattern carriers score, and it also means ten Fish and
# ten AssemblyAI sockets opening at once. A short stagger costs nothing and
# looks like a person working a list.
STAGGER_S = 1.5


def log(*parts) -> None:
    print(time.strftime("%H:%M:%S"), *parts, flush=True)


def _post_call(base: str, secret: str, lead: dialqueue.Lead, campaign: str) -> tuple[bool, str]:
    body = json.dumps({
        "to": lead.e164,
        "business": lead.business,
        "reviews": lead.reviews_count,
        "campaign": campaign,
    }).encode()
    req = urllib.request.Request(
        base.rstrip("/") + "/call", data=body, method="POST",
        headers={"Content-Type": "application/json", "x-bridge-secret": secret},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return True, resp.read().decode()[:120]
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code} {e.read().decode()[:120]}"
    except (urllib.error.URLError, OSError) as e:
        return False, f"{type(e).__name__}: {e}"


def _live_calls(base: str) -> int | None:
    """How many calls the server currently has open. None if it cannot be asked."""
    try:
        with urllib.request.urlopen(base.rstrip("/") + "/health", timeout=8) as resp:
            return int(json.loads(resp.read().decode()).get("live_calls", 0))
    except Exception:
        return None


def _outcomes(campaign: str, e164s: list[str]) -> dict[str, dict]:
    """Read back what the server recorded for exactly these numbers."""
    url = config.key("SUPABASE_URL")
    key = config.key("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key or not e164s:
        return {}
    import urllib.parse
    inlist = ",".join(urllib.parse.quote(e) for e in e164s)
    try:
        req = urllib.request.Request(
            f"{url.rstrip('/')}/rest/v1/wk_ai_called"
            f"?select=e164,outcome,duration_s,turns,booked_slot,final_stage,error,finished_at"
            f"&e164=in.({inlist})",
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return {r["e164"]: r for r in json.loads(resp.read().decode())}
    except Exception as e:
        log(f"could not read outcomes: {e}")
        return {}


def run_batch(base: str, secret: str, campaign: str, size: int, apply: bool) -> dict:
    leads = dialqueue.claim(campaign, size) if apply else _preview(campaign, size)
    if not leads:
        log("nothing left to claim, the queue is empty")
        return {"dialled": 0, "leads": []}

    log(f"batch of {len(leads)}:")
    for l in leads:
        log(f"   {l.e164}  {str(l.state or '??'):<3} "
            f"{str(l.reviews_count or '-'):>3}rev  {l.business or '(no name)'}")

    if not apply:
        log("DRY RUN, nothing claimed and nobody rung. Add --apply to dial.")
        return {"dialled": 0, "leads": leads}

    started = []
    for l in leads:
        ok, msg = _post_call(base, secret, l, campaign)
        if ok:
            started.append(l)
        else:
            log(f"   FAILED to start {l.e164}: {msg}")
            # It is already in the ledger and must stay there. Record why, so
            # the row does not sit for ever looking like a call in flight.
            dialqueue.record(l.e164, outcome="dial_failed", error=msg)
        time.sleep(STAGGER_S)
    log(f"started {len(started)}/{len(leads)} call(s), waiting for the batch to finish")

    # Wait on the OUTCOMES, not on the health count. live_calls drops the
    # moment a socket closes, which is before the transcript is saved and the
    # ledger written, so polling it would report the batch done with rows still
    # unwritten and print a table of blanks.
    want = {l.e164 for l in started}
    deadline = time.time() + BATCH_TIMEOUT_S
    done: dict[str, dict] = {}
    while time.time() < deadline and len(done) < len(want):
        time.sleep(5)
        rows = _outcomes(campaign, sorted(want))
        done = {e: r for e, r in rows.items() if r.get("finished_at")}
        live = _live_calls(base)
        log(f"   {len(done)}/{len(want)} finished"
            + (f", {live} still live on the server" if live is not None else ""))
    if len(done) < len(want):
        log(f"   giving up waiting after {BATCH_TIMEOUT_S}s; "
            f"{len(want) - len(done)} call(s) never reported back")

    log("")
    log(f"--- batch result ---")
    tally: dict[str, int] = {}
    for l in started:
        r = done.get(l.e164, {})
        oc = r.get("outcome") or "(never reported)"
        tally[oc] = tally.get(oc, 0) + 1
        booked = f"  BOOKED: {r['booked_slot']}" if r.get("booked_slot") else ""
        log(f"   {l.e164}  {oc:<16} {str(r.get('duration_s') or '-'):>4}s "
            f"{str(r.get('turns') or '-'):>3} turns  "
            f"stage={r.get('final_stage') or '-'}{booked}"
            + (f"  ERROR {r['error']}" if r.get("error") else ""))
    log(f"   totals: {tally}")
    return {"dialled": len(started), "leads": started, "tally": tally, "outcomes": done}


def _preview(campaign: str, size: int) -> list[dialqueue.Lead]:
    """Who WOULD be claimed, without claiming. Dry runs only."""
    url = config.key("SUPABASE_URL")
    key = config.key("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise dialqueue.QueueError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set")
    import urllib.parse
    q = (f"{url.rstrip('/')}/rest/v1/wk_ai_call_leads"
         f"?select=id,e164,business,reviews_count,state,timezone,website"
         f"&campaign=eq.{urllib.parse.quote(campaign)}&status=eq.queued"
         f"&order=priority.asc,created_at.asc&limit={int(size)}")
    req = urllib.request.Request(q, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        rows = json.loads(resp.read().decode())
    return [dialqueue.Lead(r["id"], r["e164"], r.get("business"), r.get("reviews_count"),
                           r.get("state"), r.get("timezone"), r.get("website")) for r in rows]


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Work the AI caller's dial queue in batches.")
    p.add_argument("--campaign", default=DEFAULT_CAMPAIGN)
    p.add_argument("--batch", type=int, default=10, help="calls at a time")
    p.add_argument("--batches", type=int, default=1, help="how many batches to run")
    p.add_argument("--apply", action="store_true", help="actually ring people")
    p.add_argument("--url", default="http://127.0.0.1:8787")
    p.add_argument("--gap", type=float, default=20.0, help="seconds between batches")
    args = p.parse_args(argv)

    secret = config.key("BRIDGE_SHARED_SECRET", required=True)
    log(f"campaign: {args.campaign}")
    log(f"standing: {dialqueue.counts(args.campaign)}")

    total = 0
    for i in range(max(1, args.batches)):
        log("")
        log(f"===== batch {i + 1} of {args.batches} =====")
        try:
            r = run_batch(args.url, secret, args.campaign, args.batch, args.apply)
        except dialqueue.QueueError as e:
            log(f"QUEUE ERROR, stopping without dialling: {e}")
            return 1
        total += r["dialled"]
        if r["dialled"] == 0:
            break
        if i + 1 < args.batches:
            log(f"pausing {args.gap:.0f}s before the next batch")
            time.sleep(args.gap)

    log("")
    log(f"done, {total} call(s) placed")
    log(f"standing: {dialqueue.counts(args.campaign)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

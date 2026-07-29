"""The dial queue, from the bridge's side.

Claiming a lead and recording how the call went. The rules live in Postgres
(supabase/migrations/20260729000003_ai_call_queue.sql), not here, and that is
deliberate: "ring this plumber once and never again" has to survive this
process being killed halfway through a batch, so it is a primary key and not a
Python variable.

Everything here fails LOUD rather than open. A screening step that fails open
costs a wasted text; a dial queue that fails open rings a stranger for the
fourth time. So a claim that cannot reach the database returns nothing to dial,
and the runner stops.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from . import config


@dataclass(frozen=True)
class Lead:
    lead_id: str
    e164: str
    business: str | None
    reviews_count: int | None
    state: str | None
    timezone: str | None
    website: str | None


class QueueError(RuntimeError):
    """The queue could not be reached or refused. Never dial after seeing this."""


def _rpc(name: str, payload: dict, timeout: float = 20.0):
    url = config.key("SUPABASE_URL")
    key = config.key("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise QueueError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set")
    req = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/rpc/{name}",
        data=json.dumps(payload).encode(),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode()
            return json.loads(body) if body.strip() else None
    except urllib.error.HTTPError as e:
        raise QueueError(f"{name}: HTTP {e.code} {e.read().decode()[:300]}") from e
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise QueueError(f"{name}: {type(e).__name__}: {e}") from e


def claim(campaign: str, limit: int) -> list[Lead]:
    """Take up to `limit` leads and mark them called, atomically.

    The rows come back ALREADY written to the ledger, so from this moment they
    will never be handed out again, whatever happens next. If the process dies
    before dialling, those leads are simply lost rather than re-dialled, which
    is the trade we want: a lost lead costs nothing, a repeat call costs a
    reputation.
    """
    rows = _rpc("wk_ai_claim_calls", {"p_campaign": campaign, "p_limit": int(limit)}) or []
    return [
        Lead(
            lead_id=r.get("lead_id", ""),
            e164=r.get("e164", ""),
            business=r.get("business"),
            reviews_count=r.get("reviews_count"),
            state=r.get("state"),
            timezone=r.get("timezone"),
            website=r.get("website"),
        )
        for r in rows
        if r.get("e164")
    ]


def record(e164: str, *, outcome: str, duration_s: int | None = None,
           turns: int | None = None, hangup_cause: str | None = None,
           transcript_path: str | None = None, booked_slot: str | None = None,
           final_stage: str | None = None, error: str | None = None) -> None:
    """Write how the call went. Never raises: the call already happened.

    Losing the outcome is bad but survivable, and the ledger row already exists
    so nobody gets rung twice because of it. Raising here would take down the
    runner mid-batch over a bookkeeping failure, which is worse.
    """
    try:
        _rpc("wk_ai_record_outcome", {
            "p_e164": e164, "p_outcome": outcome, "p_duration_s": duration_s,
            "p_turns": turns, "p_hangup_cause": hangup_cause,
            "p_transcript_path": transcript_path, "p_booked_slot": booked_slot,
            "p_final_stage": final_stage, "p_error": error,
        })
    except QueueError as e:
        print(f"QUEUE    | could not record {e164}: {e}", flush=True)


def counts(campaign: str) -> dict:
    """How the campaign stands. Best effort, for the runner's progress line."""
    url = config.key("SUPABASE_URL")
    key = config.key("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return {}
    out = {}
    for table, col in (("wk_ai_call_leads", "status"), ("wk_ai_called", "outcome")):
        try:
            req = urllib.request.Request(
                f"{url.rstrip('/')}/rest/v1/{table}"
                f"?select={col}&campaign=eq.{urllib.parse.quote(campaign)}",
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                for row in json.loads(resp.read().decode()):
                    v = row.get(col) or "(pending)"
                    out[f"{table.replace('wk_ai_', '')}.{v}"] = \
                        out.get(f"{table.replace('wk_ai_', '')}.{v}", 0) + 1
        except Exception:
            pass
    return out

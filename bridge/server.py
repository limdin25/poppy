"""The Telnyx side of the bridge: call webhooks, media websocket, call loop.

Runs on the VPS, because Telnyx has to be able to reach it from the public
internet in both directions.

    POST /call            start one outbound call   (shared-secret protected)
    POST /telnyx/webhook  call.answered, call.hangup (signature verified)
    GET  /telnyx/media    the bidirectional audio websocket
    GET  /health          is it up

Run it:
    python3 -m bridge.server                      # serve on 127.0.0.1:8787
    python3 -m bridge.server --call +447700900185 # ask a running server to dial
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import sys
import threading
import time
from pathlib import Path

from aiohttp import WSMsgType, web

from . import (agent, ai, assembly_stt, config, dialqueue, fish_stream, prosody,
               run as runmod, settings)
from .telnyx import TelnyxTransport

TRANSCRIPTS = Path(__file__).resolve().parent / "transcripts"

# Live calls, keyed by Telnyx's call_control_id. The transport registers itself
# from the dialling thread as soon as Telnyx returns an id.
CALLS: dict[str, TelnyxTransport] = {}


def log(*parts) -> None:
    print(time.strftime("%H:%M:%S"), *parts, flush=True)


def _fill(text: str | None, business: str | None, reviews: int | None) -> str:
    """Put this lead's details into a prompt or opener saved on the agent page.

    Without this, a saved opener is used exactly as typed, so the moment Hugo
    writes "Hi, is that Smith Plumbing?" into the settings box every lead in the
    country gets called Smith Plumbing. The tokens are what make a prompt he can
    see and edit safe to use on a real campaign.

    str.format is deliberately not used: the prompt is full of square brackets
    and prose, and one stray brace in something Hugo typed would raise
    mid-call. A plain replace cannot fail.

    Returns "" when the saved text needs a business name and this call has none,
    so the caller falls back to the built-in rather than saying "is that the
    business?" down the phone.
    """
    text = (text or "").strip()
    if not text:
        return ""
    if "{business}" in text and not business:
        return ""
    return (text
            .replace("{business}", business or "")
            .replace("{reviews}", str(reviews) if reviews is not None else "some"))


# --------------------------------------------------------------------------
# Webhook signature
# --------------------------------------------------------------------------

def verify_signature(raw_body: bytes, signature: str, timestamp: str) -> bool:
    """Telnyx signs every webhook with ed25519. Unsigned means untrusted.

    Fails CLOSED. A forged webhook can mark a live call answered or ended, so an
    unverified endpoint hands a stranger the ability to hang up on prospects
    mid-sentence. Verification is cheap, so there is no reason to skip it.
    """
    public_key = config.key("TELNYX_PUBLIC_KEY")
    if not public_key or not signature or not timestamp:
        return False
    # Replay window. Telnyx recommends rejecting anything older than 5 minutes.
    try:
        if abs(time.time() - int(timestamp)) > 300:
            return False
    except ValueError:
        return False
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

        key = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key))
        key.verify(base64.b64decode(signature), timestamp.encode() + b"|" + raw_body)
        return True
    except (InvalidSignature, Exception):
        return False


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------

async def health(request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "live_calls": len(CALLS)})


async def webhook(request: web.Request) -> web.Response:
    raw = await request.read()
    if not verify_signature(
        raw,
        request.headers.get("telnyx-signature-ed25519", ""),
        request.headers.get("telnyx-timestamp", ""),
    ):
        log("WEBHOOK REJECTED, bad or missing signature")
        return web.json_response({"error": "bad signature"}, status=403)

    data = json.loads(raw or b"{}").get("data", {})
    event = data.get("event_type", "")
    payload = data.get("payload", {})
    ccid = payload.get("call_control_id", "")
    call = CALLS.get(ccid)
    log(f"webhook {event} {ccid[:12]}{'' if call else '  (no live call for it)'}")

    if event == "call.initiated" and not call and _is_incoming(payload):
        # Somebody rang US. Until 2026-07-31 this line was logged as "no live
        # call for it" and dropped on the floor, which made every warm route
        # impossible: a voicemail asking them to ring back, a "call me"
        # button, a consented mobile. All of them end here.
        caller = payload.get("from", "")
        # Match them against everyone we have ever rung, BEFORE answering, so
        # the log says who it is while the phone is still ringing. This is the
        # number the whole voicemail play is measured on: nobody rings a
        # stranger back by accident.
        known = dialqueue.record_callback(caller) if caller else None
        if known:
            vm = "after a voicemail" if known.get("had_voicemail") else "with no voicemail"
            log(f"CALLBACK | {caller} is {known.get('business')} "
                f"({known.get('campaign')}), {vm}")
        else:
            log(f"INBOUND  | {caller} ringing in, not one of ours")
        threading.Thread(
            target=_run_inbound, args=(ccid, caller), daemon=True,
        ).start()
    elif event == "call.answered" and call:
        call.mark_answered()
    elif event == "call.hangup" and call:
        call.mark_ended(payload.get("hangup_cause", ""))
    elif event == "call.machine.detection.ended" and call:
        # Telnyx's verdict on what picked up. Only "machine" acts; see
        # mark_machine for why "not_sure" must not.
        result = payload.get("result", "")
        log(f"AMD      | {result} on {ccid[:12]}")
        call.mark_machine(result)
    return web.json_response({"ok": True})


def _is_incoming(payload: dict) -> bool:
    """Did they ring us, or did we ring them?

    Telnyx sends call.initiated for BOTH, and answering our own outbound call
    would be a loop, so the direction is the whole guard. It reports the
    direction from ITS point of view, so a call arriving at our number is
    "incoming", and the older API wording "inbound" is accepted too.
    """
    return str(payload.get("direction", "")).lower() in ("incoming", "inbound")


async def find_call(ccid: str, timeout: float = 5.0) -> TelnyxTransport | None:
    """Look up a call, tolerating the websocket beating the dial response.

    Telnyx can open the media socket before our own POST /calls has returned the
    id we key on, so a single lookup would lose the race intermittently.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        call = CALLS.get(ccid)
        if call is not None:
            return call
        await asyncio.sleep(0.05)
    return None


async def media(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=8 * 1024 * 1024)
    await ws.prepare(request)
    call: TelnyxTransport | None = None
    ccid = ""
    frames = 0

    async for msg in ws:
        if msg.type is not WSMsgType.TEXT:
            continue
        try:
            data = json.loads(msg.data)
        except ValueError:
            continue
        event = data.get("event")

        if event == "start":
            start = data.get("start", {})
            ccid = start.get("call_control_id", "")
            fmt = start.get("media_format", {})
            log(f"media stream open  {ccid[:12]}  {fmt.get('encoding')} "
                f"{fmt.get('sample_rate')}Hz x{fmt.get('channels')}")
            call = await find_call(ccid)
            if call is None:
                log("no call registered for that id, closing the stream")
                break
            call.attach(ws, asyncio.get_running_loop())

        elif event == "media":
            if call is not None:
                call.feed(data.get("media", {}).get("payload", ""))
                frames += 1

        elif event == "stop":
            log(f"media stream stopped {ccid[:12]} after {frames} frames")
            if call is not None:
                call.mark_ended("stream stopped")
            break

    if call is not None:
        call.mark_ended("websocket closed")
    log(f"media socket closed {ccid[:12]}, {frames} frames")
    return ws


async def start_call(request: web.Request) -> web.Response:
    secret = config.key("BRIDGE_SHARED_SECRET", required=True)
    if request.headers.get("x-bridge-secret") != secret:
        return web.json_response({"error": "forbidden"}, status=403)

    body = await request.json()
    number = body.get("to", "")
    if not number.startswith("+"):
        return web.json_response({"error": "to must be E.164, starting with +"}, status=400)

    business = body.get("business")
    reviews = body.get("reviews")
    from_number = body.get("from") or config.key("TELNYX_FROM_NUMBER", required=True)
    # Set only by the campaign runner. When present, how the call went is
    # written back to the dial ledger so the batch can be read afterwards
    # without trawling the log.
    campaign = body.get("campaign")

    threading.Thread(
        target=_run_call, args=(number, from_number, business, reviews, campaign),
        daemon=True,
    ).start()
    return web.json_response({"ok": True, "dialling": number, "from": from_number})


# Telnyx codes meaning the call was never placed at all, so nobody's phone
# rang. The dial happens on the call thread, not in POST /call, so this is the
# only place that can see them.
NEVER_RANG = ("90041",)   # user channel limit exceeded: account concurrency


def _release_if_never_rang(number: str, error: str | None) -> bool:
    """Put a lead back when Telnyx refused to dial it. True if it was freed.

    The ledger is written before the call so that a crash mid-conversation
    still counts as "we rang them". A refused dial is the opposite case: the
    phone never rang, and recording it burns a good lead for ever over a
    transient account limit. Kyle's Plumbing was lost exactly this way on the
    first mobile batch.
    """
    if not error or not any(code in str(error) for code in NEVER_RANG):
        return False
    freed = dialqueue.release(number)
    log(f"NEVER RANG | {number} channel limit, "
        f"{'back in the queue' if freed else 'COULD NOT be released'}")
    return freed


def _run_call(number: str, from_number: str, business, reviews, campaign=None) -> None:
    """One whole call, on its own thread.

    The conversation loop is synchronous and blocking by design, so it gets a
    thread rather than being rewritten around the event loop. The queue inside
    the transport is the only thing the two sides share.
    """
    def show(kind: str, text: str) -> None:
        log(f"{kind.upper():<8} | {text}")

    # Read the live settings first, so anything saved at /admin/crm/agent/fish
    # applies to THIS call. Fails soft: no Supabase means the built-in defaults.
    saved = settings.fish_config()
    changed = settings.apply(saved)
    if changed:
        log("SETTINGS | " + ", ".join(changed))

    transport = TelnyxTransport(from_number=from_number, registry=CALLS, on_event=show)
    try:
        a = agent.Agent(
            transport=transport,
            system_prompt=_fill(saved.get("system_prompt"), business, reviews)
            or runmod.SYSTEM_PROMPT,
            opener=_fill(saved.get("opener"), business, reviews)
            or runmod.build_opener(business, reviews),
            # telephony=True means every provider is asked for mu-law at 8 kHz,
            # which is what the network carries and what Telnyx wants, so there
            # is no transcoding on the call path whichever one is in use.
            # This MUST go through build_tts(): hardcoding a provider here meant
            # adding a key changed nothing, which is a config trap.
            tts=ai.build_tts(telephony=True),
            on_event=show,
            # So she can tell "Hello?" from "Waterways Plumbing, this is Mike"
            # and pick the opener that suits.
            business=business,
        )
        # Open the voice socket now, while the phone is still ringing. It costs
        # about half a second to establish and nobody is waiting during a ring;
        # paying it per reply instead would wipe out the whole benefit.
        # Live transcription, opened during the ring like the voice socket.
        # Replaces the VAD, the end-of-turn wait and batch Whisper in one go.
        if config.AAI_STREAMING and config.key("ASSEMBLYAI_API_KEY"):
            keyterms = [t for t in ["HeyElsie", "Google reviews", business] if t]
            ears = assembly_stt.AssemblyStream(keyterms=keyterms, on_event=show)
            if ears.connect():
                a.ears = ears
                transport.listener = ears.feed
                log("EARS     | live transcription open")
                # The same far-end audio, read a second way. AssemblyAI reports
                # the WORDS; this reports whether the sentence landed, from the
                # pitch falling away or rising into a question. Costs 0.7% of a
                # core, measured, and lets a finished sentence be answered in
                # 0.35s instead of the 1.1s that silence alone demands.
                if config.PROSODY_ENABLED:
                    ear_feed = ears.feed
                    reader = prosody.Prosody()
                    a.prosody = reader

                    def both(raw: bytes, _t=ear_feed, _p=reader, _tr=transport) -> None:
                        _t(raw)
                        # NOT while she is talking. Her own voice comes back off
                        # the prospect's handset, which was proved on a live
                        # call when a whole sentence of hers returned as a
                        # transcribed turn. The contour reader was therefore
                        # measuring HER intonation: the fall at the end of her
                        # own sentence read as "the prospect finished", and she
                        # answered 0.6s later into somebody who had not spoken.
                        # That is the "she doesn't wait" Hugo reported.
                        try:
                            if _tr.is_speaking():
                                _p.reset()
                                _p.quiet_until = time.monotonic() + config.ECHO_SETTLE_MS / 1000.0
                                return
                            # And for a beat AFTER she stops. Her echo arrives
                            # late, so gating only on is_speaking() still let
                            # the tail of her own sentence be read as the
                            # prospect's intonation: "fell" fired one second
                            # after she was cut off, on a live call, with the
                            # prospect silent throughout.
                            if time.monotonic() < getattr(_p, "quiet_until", 0.0):
                                return
                            _p.feed(raw)
                        except Exception as e:
                            # Never let the contour reader break transcription.
                            # It is an optimisation; the words are the product.
                            log(f"PROSODY  | reader stopped: {e}")

                    transport.listener = both
                    log("PROSODY  | pitch and loudness reader on")
            else:
                log(f"EARS     | streaming unavailable, using batch ({ears._failed})")

        if config.FISH_STREAMING and config.key("FISH_API_KEY"):
            stream = fish_stream.FishStream(
                voice_id=saved.get("voice_id") or None, on_event=show)
            if stream.connect():
                a.voice_stream = stream
                log("VOICE    | streaming socket open")
            else:
                log(f"VOICE    | streaming unavailable, using plain requests ({stream._failed})")

        result = a.call(number)
        path = agent.save_transcript(result, TRANSCRIPTS)
        wav = transport.save_recording(path.with_suffix(".wav"))
        log(f"DONE     | {result.outcome}  {result.duration:.0f}s  "
            f"{len(result.turns)} turns  -> {path.name}"
            f"{'  + ' + wav.name if wav else ''}")
        if campaign and not _release_if_never_rang(number, result.error):
            # Outcome FIRST, then the audio. The outcome row is what the runner
            # waits on to call the batch finished, and a slow upload of a
            # minute of WAV must not hold that up or, worse, push it past the
            # batch timeout and be reported as a call that never came back.
            dialqueue.record(
                number, outcome=result.outcome, duration_s=int(result.duration),
                turns=len(result.turns), hangup_cause=transport.hangup_cause,
                transcript_path=path.name, booked_slot=result.booked,
                final_stage=a.last_stage, error=result.error,
            )
            # Stamp the delivery separately: the outcome says what kind of
            # call it was, this says the message actually landed, and it is
            # the denominator of the callback rate.
            if result.voicemail_ms:
                dialqueue.record_voicemail(number, result.voicemail_ms)
            # Now the heavy part, so Hugo can play the call back in the CRM
            # instead of me reading it to him off the VPS over ssh.
            # Re-read the turns from the file just written rather than
            # re-serialising the objects, so what he sees and what is on disk
            # can never drift.
            try:
                turns = json.loads(path.read_text()).get("turns")
            except Exception:
                turns = None
            dialqueue.attach_recording(
                number, dialqueue.upload_recording(wav, number), turns)
    except Exception as e:
        log(f"CALL FAILED | {type(e).__name__}: {e}")
        if campaign and not _release_if_never_rang(number, str(e)):
            # The ledger row already exists, so this only records WHY. It must
            # never mark the number callable again.
            dialqueue.record(number, outcome="crashed", error=f"{type(e).__name__}: {e}")
    finally:
        stream = locals().get("stream")
        if stream is not None:
            stream.close()
        # Must always run: an abandoned transcription socket keeps billing
        # until their 3 hour cap.
        ears = locals().get("ears")
        if ears is not None:
            ears.close()
        if transport.call_control_id:
            CALLS.pop(transport.call_control_id, None)


# What she is when somebody rings US. Deliberately NOT the sales brief: a
# person who dials this number has already chosen to hear her, and the fastest
# way to lose them is to be pitched at. She answers the way a good receptionist
# answers, because being that receptionist IS the demonstration, and the pitch
# only happens if they ask for it.
INBOUND_PROMPT = """You are Maria, the AI receptionist at HeyElsie. Somebody \
has just RUNG YOU. You did not call them.

They are almost certainly a business owner who heard your voicemail, or who \
was given this number to hear what an AI receptionist sounds like. Either way \
they came to you, which means you never pitch first and you never rush.

HOW YOU ANSWER. Warm, quick, and useful, exactly like the best receptionist \
they have ever rung. "Good afternoon, HeyElsie, Maria speaking. How can I \
help?" is the shape. Then LISTEN and deal with whatever they actually say.

WHAT IS TRUE, and you may say all of it.
- You are an AI receptionist. Say so plainly the moment anybody asks, and \
never pretend to be a person.
- You answer every call, you do not miss any, you take messages, book jobs \
in and text people back. You do not take holidays or sick days.
- You cost ninety-seven dollars a month. A person doing this job in the \
States costs somewhere around two and a half to three and a half thousand \
dollars a month.
- They are hearing you do the job right now. This call IS the demonstration, \
and you may point that out once, lightly, if it helps.
- Somebody from the team sets you up on their line. That takes a short call.

WHAT YOU DO NOT KNOW. Anything about their business they have not told you \
on this call: how many calls they miss, who works there, what they charge. \
Never guess and never invent a statistic or a customer story.

IF THEY WANT IT, book them a short call with somebody from the team and \
write [BOOK: their day and time]. If they are only curious, answer their \
questions properly and let them go warmly. A good conversation they remember \
beats a booking you squeezed.

Plain spoken American English, contractions, one idea per turn, eight to \
twelve words is normal. Ask one question then stop. Never a long dash."""


def _run_inbound(ccid: str, caller: str) -> None:
    """Answer a call somebody made to us, and be the receptionist.

    Mirrors _run_call, minus the dialling: the call already exists and the far
    end is already on the line, so the transport is built around the id from
    the webhook and answered immediately.
    """
    def show(kind: str, text: str) -> None:
        log(f"{kind.upper():<8} | {text}")

    saved = settings.fish_config()
    settings.apply(saved)
    transport = TelnyxTransport.for_inbound(ccid, registry=CALLS, on_event=show)
    stream = ears = None
    try:
        transport.answer()
        a = agent.Agent(
            transport=transport,
            system_prompt=INBOUND_PROMPT,
            # SHE speaks first here, because she is the one who picked up.
            opener="[very warm] Good afternoon, HeyElsie, Maria speaking. How can I help?",
            tts=ai.build_tts(telephony=True),
            on_event=show,
        )
        if config.AAI_STREAMING and config.key("ASSEMBLYAI_API_KEY"):
            ears = assembly_stt.AssemblyStream(
                keyterms=["HeyElsie", "receptionist"], on_event=show)
            if ears.connect():
                a.ears = ears
                transport.listener = ears.feed
                if config.PROSODY_ENABLED:
                    ear_feed = ears.feed
                    pros = prosody.Prosody()

                    def both(raw: bytes) -> None:
                        ear_feed(raw)
                        pros.feed(raw)
                    transport.listener = both
                    a.prosody = pros
        stream = fish_stream.FishStream(on_event=show)
        if stream.connect():
            a.voice_stream = stream
        # No dial: the number is whoever rang in, and the loop is otherwise
        # identical to an outbound call from the moment of answer.
        result = a.call(caller or "inbound")
        path = agent.save_transcript(result, TRANSCRIPTS)
        wav = transport.save_recording(path.with_suffix(".wav"))
        log(f"DONE     | INBOUND {result.outcome}  {result.duration:.0f}s  "
            f"{len(result.turns)} turns  -> {path.name}"
            f"{'  + ' + wav.name if wav else ''}")
    except Exception as e:
        log(f"ERROR    | inbound call failed: {type(e).__name__}: {e}")
    finally:
        if stream is not None:
            stream.close()
        if ears is not None:
            ears.close()
        CALLS.pop(ccid, None)


def build_app() -> web.Application:
    app = web.Application()
    app.add_routes([
        web.get("/health", health),
        web.post("/call", start_call),
        web.post("/telnyx/webhook", webhook),
        web.get("/telnyx/media", media),
    ])
    return app


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Telnyx AI calling server.")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8787)
    p.add_argument("--call", help="Ask a running server to dial this number, then exit")
    p.add_argument("--business")
    p.add_argument("--reviews", type=int)
    p.add_argument("--url", default="http://127.0.0.1:8787", help="Server to talk to")
    args = p.parse_args(argv)

    if args.call:
        import urllib.request
        body = json.dumps({
            "to": args.call, "business": args.business, "reviews": args.reviews,
        }).encode()
        req = urllib.request.Request(
            args.url.rstrip("/") + "/call", data=body, method="POST",
            headers={
                "Content-Type": "application/json",
                "x-bridge-secret": config.key("BRIDGE_SHARED_SECRET", required=True),
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(resp.read().decode())
        return 0

    log(f"listening on {args.host}:{args.port}")
    log(f"stream url   {config.key('TELNYX_STREAM_URL')}")
    log(f"from number  {config.key('TELNYX_FROM_NUMBER')}")
    web.run_app(build_app(), host=args.host, port=args.port, print=None)
    return 0


if __name__ == "__main__":
    sys.exit(main())

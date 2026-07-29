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

from . import agent, ai, assembly_stt, config, fish_stream, run as runmod, settings
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

    if event == "call.answered" and call:
        call.mark_answered()
    elif event == "call.hangup" and call:
        call.mark_ended(payload.get("hangup_cause", ""))
    return web.json_response({"ok": True})


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

    threading.Thread(
        target=_run_call, args=(number, from_number, business, reviews), daemon=True
    ).start()
    return web.json_response({"ok": True, "dialling": number, "from": from_number})


def _run_call(number: str, from_number: str, business, reviews) -> None:
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
    except Exception as e:
        log(f"CALL FAILED | {type(e).__name__}: {e}")
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

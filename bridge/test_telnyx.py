"""Integration test for the Telnyx path, with a fake Telnyx on the other end.

    python3 -m bridge.test_telnyx

Places no call, spends nothing, needs no VPS. It stands in for Telnyx's media
websocket so the transport, the codec edge and the conversation loop can all be
exercised together. The one thing it cannot prove is the phone network itself.
"""
from __future__ import annotations

import base64
import math
import sys
import threading
import time
from array import array

from . import agent, audio, config, telnyx, ulaw


def tone(ms: float, dbfs: float, rate: int = 8000) -> bytes:
    n = int(rate * ms / 1000.0)
    amp = (10 ** (dbfs / 20.0)) * 32767.0 * math.sqrt(2)
    out = array("h")
    for i in range(n):
        out.append(int(max(-32767, min(32767, amp * math.sin(2 * math.pi * 300 * i / rate)))))
    return out.tobytes()


class FakeWS:
    """Stands in for the aiohttp websocket, recording what Telnyx would receive."""

    def __init__(self):
        self.sent: list[dict] = []
        self.lock = threading.Lock()

    async def send_json(self, message):
        with self.lock:
            self.sent.append(message)

    def events(self, kind):
        with self.lock:
            return [m for m in self.sent if m.get("event") == kind]

    def audio_bytes(self) -> bytes:
        with self.lock:
            return b"".join(
                base64.b64decode(m["media"]["payload"])
                for m in self.sent if m.get("event") == "media"
            )


class FakeLoop:
    """Runs the coroutine inline. The transport only needs the threadsafe shape."""

    def __init__(self):
        self.calls = 0

    def call_soon_threadsafe(self, *a, **k):
        pass


def run_coro(coro):
    try:
        coro.send(None)
    except StopIteration:
        pass


class InlineFuture:
    def __init__(self, coro):
        run_coro(coro)

    def result(self, timeout=None):
        return None


CASES = []


def case(name):
    def wrap(fn):
        CASES.append((name, fn))
        return fn
    return wrap


def make_transport(monkeypatched=True):
    t = telnyx.TelnyxTransport(from_number="+18336480769")
    ws = FakeWS()
    # Go through attach(), the same door the real media websocket comes in by,
    # so the transport ends up in the state a live call actually reaches.
    t.attach(ws, FakeLoop())
    if monkeypatched:
        telnyx.asyncio.run_coroutine_threadsafe = lambda coro, loop: InlineFuture(coro)
    return t, ws


# -- the codec edge ---------------------------------------------------------

@case("inbound mu-law arrives upstream as 16 kHz PCM at the same level and duration")
def _():
    t, _ = make_transport()
    src = tone(1000, -20.0, rate=8000)          # 1 second at 8 kHz
    frame = base64.b64encode(ulaw.encode(src)).decode()
    t.feed(frame)
    got = t.read(timeout=1.0)
    assert got is not None, "nothing reached the queue"
    ms = audio.ms_of(got)                        # measured at config.AI_RATE
    assert 995 < ms < 1005, f"duration became {ms:.0f}ms, so every timing upstream is wrong"
    lvl = audio.rms_dbfs(got)
    assert abs(lvl - (-20.0)) < 1.5, f"level became {lvl:.1f} dBFS"


@case("a corrupt frame is dropped, not crashed on")
def _():
    t, _ = make_transport()
    t.feed("not base64 at all !!!")
    t.feed("")
    assert t.read(timeout=0.05) is None


# -- talking back -----------------------------------------------------------

@case("speak sends the audio chunked, level intact, with the floor under it")
def _():
    # This used to assert the EXACT bytes went out. That contract changed on
    # purpose, 2026-07-31: Telnyx plays our frames sequentially, so the room
    # tone cannot be sent alongside the voice, it has to be MIXED INTO it, or
    # the ambient floor drops dead the instant she starts talking and comes
    # back when she stops, which is the exact tell Hugo reported. The voice
    # must come through untouched to the ear: -48 dB under -18 dB moves the
    # measured level by under 0.05 dB.
    t, ws = make_transport()
    payload = ulaw.encode(tone(1000, -18.0, rate=8000))   # 8000 bytes = 1 second
    t.speak(payload)
    sent = ws.audio_bytes()
    assert len(sent) == len(payload), "duration was altered on the way out"
    lvl = audio.rms_dbfs(ulaw.decode(sent))
    assert abs(lvl - (-18.0)) < 1.0, f"voice level became {lvl:.1f} dBFS"
    frames = ws.events("media")
    assert len(frames) == 5, f"expected 5 x 200ms frames, got {len(frames)}"


@case("the room tone rides UNDER the voice, so the floor never drops")
def _():
    # Digital silence inside a spoken payload (the gap between two sentences
    # of one reply) must leave carrying the room tone, not nothing: true zero
    # for 300ms sounds like the line dropping.
    t, ws = make_transport()
    quiet = ulaw.encode(b"\x00\x00" * 1600)               # 200ms of pure silence
    t.speak(quiet)
    out = ulaw.decode(ws.audio_bytes())
    lvl = audio.rms_dbfs(out)
    assert lvl > -60.0, f"a silent frame went out truly dead at {lvl:.1f} dBFS"
    assert lvl < telnyx.COMFORT_NOISE_DBFS + 6.0, f"floor too loud: {lvl:.1f} dBFS"


@case("playback duration is derived from the byte count, so is_speaking is honest")
def _():
    t, _ = make_transport()
    t.speak(ulaw.encode(tone(600, -18.0, rate=8000)))
    assert t.is_speaking(), "should still be playing 600ms of audio"
    time.sleep(0.65)
    assert not t.is_speaking(), "should have finished after 600ms"


@case("barge-in flushes Telnyx's queue instead of just stopping sends")
def _():
    # Without the clear, audio already buffered on their side keeps playing and
    # the AI talks over the prospect for seconds after we decided to stop.
    t, ws = make_transport()
    t.speak(ulaw.encode(tone(5000, -18.0, rate=8000)))
    assert t.is_speaking()
    t.stop_speaking()
    assert ws.events("clear"), "no clear event sent, barge-in would not be audible"
    assert not t.is_speaking()


@case("comfort noise is quiet, and never runs before answer or after hangup")
def _():
    import time as _t
    from . import audio as _audio, telnyx as _telnyx
    t, ws = make_transport()

    # Quiet enough that it can never be mistaken for the prospect talking, even
    # after echoing off their handset. It sits well below the interrupt margin.
    frame = t._comfort_frame()
    level = _audio.rms_dbfs(ulaw.decode(frame))
    # Room tone, not hiss: a room is weighted low. Measured across the band,
    # 0-300 Hz sits 23 dB above 3-4 kHz. Checked here as a rough energy split so
    # the filter cannot be removed without the test noticing.
    prev = ulaw.decode(t._comfort_frame())
    vals = [int.from_bytes(prev[i:i+2], "little", signed=True)
            for i in range(0, len(prev), 2)]
    steps = [abs(b - a) for a, b in zip(vals, vals[1:])]
    spread = max(abs(v) for v in vals)
    assert sum(steps) / len(steps) < spread, (
        "samples jump as much as the signal swings, which is hiss not room tone"
    )
    assert abs(level - _telnyx.COMFORT_NOISE_DBFS) < 3, level
    assert level < -config.TELNYX_BARGE_MARGIN_DB - 15, (
        f"{level:.0f} dBFS is close enough to the interrupt threshold to trip it"
    )

    # Not while it is still ringing.
    _t.sleep(0.3)
    assert not ws.events("media"), "sent noise into a phone that was still ringing"

    # And it stops dead on hangup. This is the one that matters: audio after
    # hangup is audio into somebody else's call.
    t.mark_answered()
    _t.sleep(0.5)
    assert ws.events("media"), "no comfort noise once the call was answered"
    t.mark_ended("done")
    sent = len(ws.events("media"))
    _t.sleep(0.5)
    assert len(ws.events("media")) == sent, "kept sending after hangup"


@case("speaking after the call ended sends nothing")
def _():
    t, ws = make_transport()
    t.mark_ended("far end hung up")
    t.speak(ulaw.encode(tone(500, -18.0, rate=8000)))
    assert not ws.events("media"), "kept sending audio into a dead call"
    assert not t.is_speaking()


# -- the whole loop ---------------------------------------------------------

@case("a full call runs end to end over the fake socket")
def _():
    t, ws = make_transport()

    class FakeTTS:
        def say(self, text):
            # 15 chars/sec, roughly what the real voice does.
            return ulaw.encode(tone(max(200, len(text) / 15 * 1000), -18.0, rate=8000))

    class FakeSTT:
        def __init__(self): self.n = 0
        def transcribe(self, pcm):
            self.n += 1
            return "Go on then, what is it?" if self.n == 1 else ""

    class FakeBrain:
        def __init__(self): self.system_prompt = ""; self.history = []
        def note_opening(self, o, truncated=False): pass
        def set_stage(self, brief):
            self.stage_brief = brief

        def stream_sentences(self, heard):
            yield "We get trades more Google reviews.", False
            yield "Shall I have a colleague ring you? [END]", True

    # The far end: answers, hears the opener out, replies, then goes quiet.
    # It has to wait its turn. Talking during the opener is correctly treated as
    # stale audio and drained, which is what an earlier version of this test got
    # wrong: it "proved" a bug that was actually the echo defence working.
    def send(ms=20.0, db=-60.0):
        t.feed(base64.b64encode(ulaw.encode(tone(ms, db, rate=8000))).decode())

    def far_end():
        time.sleep(0.2)
        t.mark_answered()
        while not t.is_speaking() and not t.ended:      # waiting for the opener
            send(); time.sleep(0.02)
        while t.is_speaking() and not t.ended:          # listening to it
            send(); time.sleep(0.02)
        time.sleep(0.6)                                 # a beat, past the echo settle
        for _ in range(40):                             # ~800ms of reply
            send(20, -22.0); time.sleep(0.01)
        while not t.ended:                              # quiet for the rest
            send(); time.sleep(0.02)

    # Dial is the one part we stub: it would place a real call.
    t.dial = lambda number: None
    threading.Thread(target=far_end, daemon=True).start()

    a = agent.Agent(t, "sys", "Hi, I'm Elsie, an AI assistant, so you know upfront.",
                    stt=FakeSTT(), tts=FakeTTS())
    a.brain = FakeBrain()
    result = a.call("+447700900185")

    assert result.answered, "never registered an answer"
    said = [x for x in result.turns if x.who.startswith("ai")]
    heard = [x for x in result.turns if x.who == "them"]
    assert said, "the AI never spoke"
    assert heard, "the prospect's turn was never transcribed"
    assert result.outcome == "completed", f"outcome was {result.outcome}"
    assert not any("[" in x.text for x in result.turns), "the [END] marker leaked into speech"
    assert len(ws.audio_bytes()) > 8000, "less than a second of audio reached the far end"


def main() -> int:
    failed = 0
    for name, fn in CASES:
        try:
            fn()
            print(f"  ok   {name}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL {name}\n         {e}")
        except Exception as e:
            failed += 1
            import traceback
            failed_line = traceback.format_exc().strip().splitlines()[-1]
            print(f"  ERR  {name}\n         {failed_line}")
    print(f"\n{len(CASES) - failed}/{len(CASES)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

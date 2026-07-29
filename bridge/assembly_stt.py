"""AssemblyAI Universal-3.5 Pro, listening while the prospect is still talking.

This replaces more than the transcription. The old path waited for silence, then
uploaded the whole clip, then waited for text: measured at 250ms + 478ms before
the model could even start thinking. AssemblyAI transcribes continuously and
tells us when a turn ENDS, so by the time somebody stops speaking the words are
already here.

Two things their docs are emphatic about, and both are free wins for us:

  "Phone audio (encoding=pcm_mulaw, sample_rate=8000) is sent as-is, don't
   upsample. Upsampling degrades accuracy."

Telnyx hands us exactly that format, so the bytes go straight through with no
conversion at all. The Whisper path had to decode mu-law and upsample to 16 kHz,
which was both work and, per the above, actively harmful.

  agent_context: "your agent's most recent spoken reply... has the biggest
   impact on short replies ('yes', '7pm', single names) and spelled-out
   entities."

So Elsie's last line is pushed over after every reply. On a sales call the
answers are mostly short ("yeah", "about twenty", "no ta"), which is precisely
the case it helps with.

Auth is the raw key with NO Bearer prefix. Their docs call this out as the
single most common integration mistake.
"""
from __future__ import annotations

import asyncio
import json
import queue
import threading
import time
import urllib.parse

from . import config

BASE = "wss://streaming.assemblyai.com/v3/ws"

# AssemblyAI accepts 50-1000ms of audio per chunk. Telnyx delivers 20ms frames,
# so they MUST be gathered up before forwarding: sending them raw earns close
# code 3007 and the socket dies mid-call. 100ms at 8 kHz mu-law is 800 bytes,
# comfortably inside their window and small enough not to add real delay.
SEND_MS = 100
SEND_BYTES = 8000 * SEND_MS // 1000


class AssemblyStream:
    """A live transcription socket for one call.

    Audio goes in as raw mu-law; finished turns come out of `next_turn()`.
    Deliberately synchronous on the outside: the conversation loop is threaded
    and blocking, so the asyncio parts stay sealed in here.
    """

    def __init__(self, keyterms: list[str] | None = None, on_event=None):
        self.api_key = config.key("ASSEMBLYAI_API_KEY", required=True)
        self.keyterms = keyterms or []
        self.on_event = on_event or (lambda kind, text: None)

        self._loop: asyncio.AbstractEventLoop | None = None
        self._ws = None
        self._turns: queue.Queue = queue.Queue()
        self._ready = threading.Event()
        self._failed: str | None = None
        self._closing = False
        self._partial = ""
        self._speaking_since = 0.0
        self._out = bytearray()
        # When the current partial last CHANGED, and the last one we already
        # answered, so a partial acted on early is not answered twice when
        # its final version arrives.
        self._partial_at = 0.0
        self._last_seen = ""

    # -- lifecycle -----------------------------------------------------------

    def connect(self, timeout: float = 15.0) -> bool:
        """Open the socket during the ring, so the call itself pays nothing."""
        threading.Thread(target=self._run_loop, daemon=True).start()
        if not self._ready.wait(timeout=timeout):
            self._failed = self._failed or "timed out opening the AssemblyAI socket"
            return False
        return self._failed is None

    def _url(self) -> str:
        params = {
            "speech_model": "universal-3-5-pro",
            # Telnyx carries exactly this. Sent untouched, per their docs.
            "encoding": "pcm_mulaw",
            "sample_rate": "8000",
            # Latency over accuracy: the whole reason we are here. Flip to
            # "balanced" if regional accents start coming back wrong.
            "mode": config.AAI_MODE,
            "format_turns": "true",
        }
        if self.keyterms:
            params["keyterms_prompt"] = json.dumps(self.keyterms[:100])
        if config.AAI_PROMPT:
            params["prompt"] = config.AAI_PROMPT
        return BASE + "?" + urllib.parse.urlencode(params)

    def _run_loop(self) -> None:
        try:
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
            self._loop.run_until_complete(self._session())
        except Exception as e:                       # pragma: no cover - network
            self._failed = f"{type(e).__name__}: {e}"
            self._ready.set()

    async def _session(self) -> None:
        import websockets

        try:
            self._ws = await websockets.connect(
                self._url(),
                # Raw key, NO "Bearer". Their docs flag this as the most common
                # mistake people make with this API.
                additional_headers={"Authorization": self.api_key},
                max_size=None,
                open_timeout=12,
            )
        except Exception as e:
            self._failed = f"could not open AssemblyAI socket: {e}"
            self._ready.set()
            return

        self._ready.set()
        try:
            async for raw in self._ws:
                if isinstance(raw, bytes):
                    continue
                msg = json.loads(raw)
                kind = msg.get("type")
                if kind == "Turn":
                    text = (msg.get("transcript") or "").strip()
                    if msg.get("end_of_turn"):
                        self._partial = ""
                        # Already answered from the partial? Then this final
                        # is old news; replying again would repeat the turn.
                        if text and text != self._last_seen:
                            self._turns.put(text)
                        self._last_seen = ""
                    else:
                        # A partial means they are mid-sentence. Worth knowing:
                        # it is how we tell "still talking" from "gone quiet"
                        # without running a VAD of our own.
                        if text != self._partial:
                            self._partial = text
                            self._partial_at = time.monotonic()
                        self._speaking_since = time.monotonic()
                elif kind == "SpeechStarted":
                    self._speaking_since = time.monotonic()
                elif kind == "Termination":
                    break
        except Exception as e:
            if not self._closing:
                self.on_event("error", f"AssemblyAI socket dropped: {e}")
        finally:
            self._turns.put(None)

    def close(self) -> None:
        """Always call this. An abandoned socket bills until a 3 hour cap."""
        self._closing = True
        if self._ws is None or self._loop is None:
            return

        async def bye() -> None:
            try:
                await self._ws.send(json.dumps({"type": "Terminate"}))
                await self._ws.close()
            except Exception:
                pass

        try:
            asyncio.run_coroutine_threadsafe(bye(), self._loop).result(timeout=3)
        except Exception:
            pass

    # -- audio in ------------------------------------------------------------

    def feed(self, ulaw_bytes: bytes) -> None:
        """Buffer far-end audio and forward it in chunks they will accept.

        This buffering is NOT optional. Telnyx delivers 20ms frames and
        AssemblyAI requires 50-1000ms per chunk; forwarding the frames straight
        through gets close code 3007 ("audio chunk outside 50-1000ms, or sent
        faster than real-time") and the socket is dropped. On a live call that
        looked like the agent going deaf seven seconds in: she opened, the
        prospect said hello, and nothing came back.

        The audio itself is still passed through untouched. Only the packaging
        changes.
        """
        if self._failed or self._ws is None or self._loop is None or self._closing:
            return
        self._out.extend(ulaw_bytes)
        if len(self._out) < SEND_BYTES:
            return
        chunk = bytes(self._out[:SEND_BYTES])
        del self._out[:SEND_BYTES]
        try:
            asyncio.run_coroutine_threadsafe(self._ws.send(chunk), self._loop)
        except Exception:
            pass

    def set_agent_context(self, text: str) -> None:
        """Tell it what Elsie just said, to sharpen what it expects next.

        Their docs: biggest impact on short replies and spelled-out entities,
        which on a sales call is most of them.
        """
        if not text or self._ws is None or self._loop is None or self._closing:
            return
        payload = json.dumps({
            "type": "UpdateConfiguration",
            "agent_context": text[-1750:],   # they keep the tail, so do we
        })
        try:
            asyncio.run_coroutine_threadsafe(self._ws.send(payload), self._loop)
        except Exception:
            pass

    # -- text out ------------------------------------------------------------

    def settled_partial(self, stable_for_s: float,
                        min_words: int | None = None) -> str | None:
        """A partial that has stopped growing, i.e. they have paused.

        This is what makes the agent quick. AssemblyAI is deliberately patient
        about declaring a turn over, roughly two seconds, because it would
        rather be right than fast. But it publishes partials continuously, and a
        partial that has not changed for a few hundred milliseconds means the
        person has stopped talking RIGHT NOW.

        So we can act on that instead of waiting to be told, which is how a
        human does it: you do not wait for proof somebody has finished, you
        start answering when they pause and back off if they carry on.

        Returns None while they are still going.
        """
        text = self._partial.strip()
        if not text or self._last_seen == text:
            return None
        if time.monotonic() - self._partial_at < stable_for_s:
            return None
        # A fragment is not a turn. See SETTLED_PARTIAL_MIN_WORDS. The caller
        # can ask for a higher bar: the prosody fast path does, because acting
        # on a shorter wait needs a stronger reason to believe the turn is over.
        if min_words is None:
            min_words = config.SETTLED_PARTIAL_MIN_WORDS
        if len(text.split()) < min_words:
            return None
        return text

    def accept(self, text: str) -> None:
        """Mark a partial as answered, so its final version is not replied to twice."""
        self._last_seen = text
        self._partial = ""

    def next_turn(self, timeout: float) -> str | None:
        """The next finished utterance, or None if nothing arrives in time."""
        try:
            return self._turns.get(timeout=timeout)
        except queue.Empty:
            return None

    def is_talking(self, within_s: float = 1.5) -> bool:
        """Are they mid-sentence right now? Used to avoid talking over them."""
        return bool(self._partial) and (time.monotonic() - self._speaking_since) < within_s

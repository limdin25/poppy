"""Fish Audio over a WebSocket held open for the whole call.

Why this exists: the plain HTTP call renders the entire clip before a single
sound comes out. Measured, that is 477ms on a short reply and up to 1150ms on a
longer one, and all of it is silence the prospect sits through. Streaming starts
audio on the first chunk instead.

Measured on our own key, all on the FREE model:

    connection + session start   ~510ms   paid ONCE per call
    first audio, reply 1          271ms
    first audio, reply 2          278ms   same socket, no reconnect
    (plain HTTP, for comparison)  477ms, up to 1150ms

So the socket is opened once while the phone rings and every reply after that
starts speaking in about a quarter of a second.

Raw PCM, not WAV: a WAV stream puts a RIFF header in the first chunk of every
flush, and stripping headers out of a live audio stream is exactly the class of
bug that made the SIM rig answer calls that were still ringing.

The public interface is deliberately synchronous. The conversation loop is
threaded and blocking by design, so the asyncio machinery stays sealed in here
behind an ordinary generator.
"""
from __future__ import annotations

import asyncio
import queue
import threading
import time

import re

from . import audio, config, ulaw

_CUE = re.compile(r"\[[^\]]*\]")


def speakable(text: str) -> bool:
    """Is there anything here a voice could actually say?

    "...", a stray "?", or a bare cue tag handed to the model is pure
    reference-language fuel: with no words to say, it says what its reference
    audio says, which on a community voice meant Chinese and a meow on live
    calls. Silence is the correct rendering of no words.
    """
    return bool(re.search(r"[A-Za-z0-9]", _CUE.sub(" ", text or "")))
# A full stop after one of these is an abbreviation, not the end of a thought.
_ABBREV = frozenset({
    "mr", "mrs", "ms", "dr", "st", "ave", "rd", "inc", "ltd", "co", "corp",
    "jr", "sr", "vs", "etc", "no", "approx", "dept", "est",
})


def _flush_point(buf: str, scan: int) -> tuple[int | None, int]:
    """Where the first sentence ends, or None if there is not one yet.

    Returns (cut, new_scan). `scan` is how far we have already looked, and
    carrying it is the whole fix.

    THE BUG THIS REPLACES. The old line was
        head = buf.split(".")[0].split("?")[0].split("!")[0]
    which always measured the FIRST sentence of the whole buffer. So a reply
    opening with a short one, "Brilliant." or "Hi there.", failed the 3-word
    test, and because the next terminator recomputed the very same head it
    failed again, and again, for the whole turn. The early flush then never
    fired at all and the reply sat unsynthesised until the model finished:
    those turns were on the 2110ms path, not the 592ms one, which is most of
    the latency win we thought we had banked.

    Three rules, each paid for:
      - a SENTENCE, never a comma. Flushing at the first comma was measured and
        reverted: it added 0.6s of seam and squashed the cue spread.
      - the terminator needs whitespace after it, or "you're at 4" flushes away
        from ".2 stars" and she reads a decimal as two sentences.
      - at least three SPOKEN words, cues not counted, so "[very warm] Hi." is
        two words and not four, and the first chunk is never the tiny chunk the
        comma build was rejected for.
    """
    i = max(0, scan)
    while True:
        nxt = -1
        for c in ".!?":
            at = buf.find(c, i)
            if at >= 0 and (nxt < 0 or at < nxt):
                nxt = at
        if nxt < 0:
            return None, i

        if buf[nxt] == ".":
            # Only a full stop is ambiguous. At the very end of the buffer it
            # could still turn out to be a decimal point with the digits not
            # arrived yet, so wait rather than guess.
            if nxt + 1 >= len(buf):
                return None, i
            if not buf[nxt + 1].isspace():
                i = nxt + 1                 # "4.2", "Mr.Patel": not an end
                continue
            # An abbreviation is not a sentence. "I spoke to Mr. Patel" would
            # otherwise flush mid-name and put a prosodic seam inside it.
            word = _CUE.sub(" ", buf[:nxt]).split()
            if word and word[-1].lower() in _ABBREV:
                i = nxt + 1
                continue
        # "?" and "!" cannot be anything but the end of a sentence, so they do
        # not need a following character. Requiring one meant a reply ending on
        # its question mark, which is every good turn she takes, never flushed.

        head = _CUE.sub(" ", buf[:nxt])
        if len(head.split()) >= 3:
            return nxt + 1, nxt + 1
        i = nxt + 1                         # too short, keep looking

URL = "wss://api.fish.audio/v1/tts/live"
# Sentinel meaning "this utterance is finished", pushed onto the audio queue.
_DONE = object()


class FishStream:
    """One persistent Fish connection, driven from ordinary threaded code."""

    def __init__(self, voice_id: str | None = None, on_event=None):
        self.api_key = config.key("FISH_API_KEY", required=True)
        self.voice_id = voice_id or config.FISH_VOICE
        if not self.voice_id:
            raise RuntimeError("Fish needs a voice id, or every request invents a new voice.")
        self.on_event = on_event or (lambda kind, text: None)

        self._loop: asyncio.AbstractEventLoop | None = None
        self._ws = None
        self._audio: queue.Queue = queue.Queue()
        self._ready = threading.Event()
        self._failed: str | None = None
        self._closing = False

    # -- lifecycle -----------------------------------------------------------

    def connect(self, timeout: float = 20.0) -> bool:
        """Open the socket. Call it during the ring, when nobody is waiting."""
        threading.Thread(target=self._run_loop, daemon=True).start()
        if not self._ready.wait(timeout=timeout):
            self._failed = self._failed or "timed out opening the Fish socket"
            return False
        return self._failed is None

    def _run_loop(self) -> None:
        try:
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
            self._loop.run_until_complete(self._session())
        except Exception as e:                     # pragma: no cover - network
            self._failed = f"{type(e).__name__}: {e}"
            self._ready.set()

    async def _session(self) -> None:
        import msgpack
        import websockets

        try:
            self._ws = await websockets.connect(
                URL,
                additional_headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "model": config.FISH_MODEL,
                },
                max_size=None,
                open_timeout=15,
            )
            await self._ws.send(msgpack.packb({
                "event": "start",
                "request": {
                    "text": "",
                    "reference_id": self.voice_id,
                    # Raw samples. See the module docstring on why not WAV.
                    "format": "pcm",
                    "sample_rate": 8000,
                    "latency": config.FISH_LATENCY,
                    "chunk_length": config.FISH_CHUNK,
                    # Text normalization, same as the HTTP path has always
                    # sent. Numbers and prices read raw are a stability risk,
                    # and the two paths should speak "149" the same way.
                    "normalize": True,
                    # Carry voice and prosody across chunk boundaries. It is
                    # their default, but a long reply that overflows
                    # chunk_length is still split, and this is what stops the
                    # second half arriving in a different mood to the first.
                    "condition_on_previous_chunks": True,
                    "temperature": config.FISH_TEMPERATURE,
                    "top_p": config.FISH_TOP_P,
                    "prosody": {
                        "speed": config.FISH_SPEED,
                        "volume": config.FISH_VOLUME,
                        "normalize_loudness": True,
                    },
                },
            }))
        except Exception as e:
            self._failed = f"could not open Fish socket: {e}"
            self._ready.set()
            return

        self._ready.set()
        # Reader: everything the socket produces lands on a plain queue, which
        # is the only thing the calling thread ever touches.
        try:
            async for raw in self._ws:
                if isinstance(raw, str):
                    continue
                msg = msgpack.unpackb(raw, raw=False)
                event = msg.get("event")
                if event == "audio":
                    chunk = msg.get("audio") or b""
                    if chunk:
                        self._audio.put(chunk)
                elif event in ("finish", "stop"):
                    self._audio.put(_DONE)
        except Exception as e:
            if not self._closing:
                self.on_event("error", f"Fish socket dropped: {e}")
        finally:
            self._audio.put(_DONE)

    def close(self) -> None:
        self._closing = True
        if self._ws is not None and self._loop is not None:
            try:
                asyncio.run_coroutine_threadsafe(self._ws.close(), self._loop)
            except Exception:
                pass

    # -- speaking ------------------------------------------------------------

    def stream_tokens(self, tokens):
        """Feed the model's output straight in, token by token, as it is written.

        This is the difference between "fast" and "real time". Sending a whole
        sentence means waiting for the model to finish one first, which is about
        a second of nothing. Fish buffers the tokens itself and starts
        synthesising as soon as it has enough context, so speech begins while
        Claude is still writing the rest.

        Their docs are explicit about it: "The WebSocket buffers incoming text
        and generates audio once it has enough context for natural-sounding
        speech, so you don't need to batch tokens yourself."

        Yields mu-law chunks. The consumer may abandon it at any point, which is
        what barge-in does, so the sending side has to survive that.
        """
        import msgpack

        if self._failed or self._loop is None or self._ws is None:
            return
        while True:
            try:
                self._audio.get_nowait()
            except queue.Empty:
                break

        done = threading.Event()

        def pump() -> None:
            """Push tokens in as they arrive, flushing at the first SENTENCE.

            An earlier version flushed at the first comma too, which cut mean
            time to first audio from 1630ms to 1235ms. It has been taken out
            again, because measured against a single-shot render of the same
            line the split costs more than it buys:

                                one shot   split after 3 words
                bare              3.89s          4.51s
                excited           3.81s          4.71s
                calm              3.99s          4.75s
                delighted         4.27s          4.43s

            Two things there. Every split line runs about 0.6s longer, which is
            a seam in the middle of a sentence nobody would pause in. And the
            spread BETWEEN cues collapses from 0.46s to 0.32s, because the cue
            sits at the start of the reply and only ever coloured the first
            chunk. Fish's own guidance says to give an emotion enough text to
            develop, and a three word chunk denies it exactly that.

            Hugo, on the split build: "its tonality are not really coming
            across naturally".

            A FULL STOP is a different proposition, and this is the version that
            works. The first sentence is enough text for an emotion to develop,
            which is Fish's own guidance, and the seam lands where a speaker
            pauses anyway. Measured on a two-sentence reply, with the text fed in
            at the rate Claude actually writes it:

                flush at the end only        2110ms to first audio, 6.84s spoken
                flush at the first sentence   592ms to first audio, 7.20s spoken

            A second and a half sooner, for 0.36s of pause at a full stop. The
            comma version bought a third of that and cost twice as much.
            """
            buf = ""
            flushed = False
            # How far along buf we have already looked for a sentence end.
            # Without this the search restarts at zero every time and keeps
            # re-judging the same short opening sentence for ever.
            scan = 0
            try:
                for token in tokens:
                    if done.is_set():
                        break
                    asyncio.run_coroutine_threadsafe(
                        self._ws.send(msgpack.packb({"event": "text", "text": token})),
                        self._loop,
                    )
                    if flushed:
                        continue
                    buf += token
                    # A sentence, not a clause. Needs real words in front of it
                    # so "Mr." or an opening cue cannot trigger it, and a
                    # question mark counts because she stops dead after one.
                    if any(c in token for c in ".!?"):
                        cut, scan = _flush_point(buf, scan)
                        if cut is not None:
                            asyncio.run_coroutine_threadsafe(
                                self._ws.send(msgpack.packb({"event": "flush"})),
                                self._loop,
                            )
                            # CARRY THE EMOTION OVER THE SEAM.
                            #
                            # A cue only ever coloured its own chunk. That is
                            # not a guess, it is what the comma-flush build
                            # measured: the spread between cues collapsed from
                            # 0.46s to 0.32s once the reply was split, "because
                            # the cue sits at the start of the reply and only
                            # ever coloured the first chunk". Hugo heard it as
                            # "its tonality are not really coming across
                            # naturally".
                            #
                            # The full-stop flush has the same hole, just once
                            # instead of every few words: sentence one is warm
                            # and everything after it is flat. So the last cue
                            # of the flushed chunk is re-sent at the head of the
                            # next one, which is the only continuation signal
                            # the API gives us.
                            #
                            # It lands after any text that followed the full
                            # stop inside the same token, so on those turns the
                            # tag sits a word or two into the sentence rather
                            # than in front of it. Fish reads cues in band
                            # wherever they appear, so that costs placement
                            # precision, not the emotion.
                            cues = _CUE.findall(buf[:cut])
                            if cues:
                                asyncio.run_coroutine_threadsafe(
                                    self._ws.send(msgpack.packb(
                                        {"event": "text", "text": cues[-1] + " "})),
                                    self._loop,
                                )
                            flushed = True
            except Exception as e:
                self.on_event("error", f"token stream failed: {e}")
            finally:
                # Flush forces out whatever is still buffered, so the last few
                # words are not left sitting in Fish waiting for more input.
                try:
                    asyncio.run_coroutine_threadsafe(
                        self._ws.send(msgpack.packb({"event": "flush"})), self._loop
                    )
                except Exception:
                    pass

        threading.Thread(target=pump, daemon=True).start()

        started = time.monotonic()
        heard_any = False
        level = audio.Leveller()
        try:
            while True:
                wait = config.FISH_QUIET_TAIL_S if heard_any else config.FISH_FIRST_AUDIO_S
                try:
                    item = self._audio.get(timeout=wait)
                except queue.Empty:
                    return
                if item is _DONE:
                    return
                heard_any = True
                if time.monotonic() - started > config.MAX_UTTERANCE_MS / 1000.0:
                    return
                yield ulaw.encode(level.apply(item))
        finally:
            done.set()

    def stream(self, text: str):
        """Yield mu-law chunks for `text` as Fish produces them.

        Silence between chunks is how we know the utterance ended: Fish does not
        send a per-flush terminator, so a short quiet period after audio has
        started is the signal. Erring long here only delays the handover to
        listening; erring short would clip the end of her sentence.
        """
        import msgpack

        if self._failed or self._loop is None or self._ws is None:
            return
        if not speakable(text):
            return
        # Drop anything left over from a previous utterance, so a barge-in does
        # not leak the tail of the abandoned reply into the next one.
        while True:
            try:
                self._audio.get_nowait()
            except queue.Empty:
                break

        async def send() -> None:
            await self._ws.send(msgpack.packb({"event": "text", "text": text}))
            await self._ws.send(msgpack.packb({"event": "flush"}))

        asyncio.run_coroutine_threadsafe(send(), self._loop)

        started = time.monotonic()
        heard_any = False
        level = audio.Leveller()
        while True:
            # Generous before the first chunk, tight after it.
            wait = config.FISH_QUIET_TAIL_S if heard_any else config.FISH_FIRST_AUDIO_S
            try:
                item = self._audio.get(timeout=wait)
            except queue.Empty:
                return
            if item is _DONE:
                return
            heard_any = True
            if time.monotonic() - started > config.MAX_UTTERANCE_MS / 1000.0:
                return
            yield ulaw.encode(item)

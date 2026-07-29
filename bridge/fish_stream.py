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

from . import audio, config, ulaw

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
                        head = buf.split(".")[0].split("?")[0].split("!")[0]
                        if len(head.split()) >= 3:
                            asyncio.run_coroutine_threadsafe(
                                self._ws.send(msgpack.packb({"event": "flush"})),
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

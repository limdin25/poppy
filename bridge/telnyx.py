"""Telnyx Call Control transport.

Same `Transport` interface as the SIM rig, so the conversation loop, the VAD,
the barge-in handling and the transcripts are all unchanged. Only the pipe is
different, and this one is digital, so it scales past one call at a time.

    Telnyx  --(wss, base64 PCMU 8k)-->  server.py  -->  this transport
                                                          |
                                                    16 kHz mono PCM
                                                          |
                                                     agent.py loop

The audio the network actually carries is 8 kHz mu-law. Everything above the
transport is defined in 16 kHz mono, so the conversion happens here and nowhere
else, and every duration and threshold upstream stays in one unit.
"""
from __future__ import annotations

import asyncio
import base64
import json
import queue
import threading
import time
import urllib.error
import urllib.request

from . import audio, config, ulaw
from .transport import Transport

API = "https://api.telnyx.com/v2"

# mu-law at 8 kHz is exactly 8000 bytes per second, which makes playback
# duration arithmetic rather than a guess. That is how is_speaking() works
# without waiting for Telnyx to tell us anything.
ULAW_BYTES_PER_SECOND = 8000
# How much audio to put in one websocket frame. Telnyx accepts 20ms to 30s.
SEND_CHUNK_MS = 200


def _request(method: str, path: str, body: dict | None = None, timeout: int = 30) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        API + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {config.key('TELNYX_API_KEY', required=True)}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="ignore")[:500]
        raise RuntimeError(f"Telnyx {method} {path} returned {e.code}: {detail}") from None


class TelnyxTransport(Transport):
    """One outbound call over Telnyx, with bidirectional media streaming.

    Created before the call exists. `dial()` places it and then blocks until
    Telnyx opens the media websocket back to us, which the server attaches with
    `attach()`. That ordering is why `Transport.dial` can stay synchronous even
    though the audio path is asynchronous.
    """

    def __init__(self, from_number: str, registry: dict | None = None, on_event=None):
        self.from_number = from_number
        self.call_control_id: str | None = None
        # Where the media websocket will come looking for us. Telnyx identifies
        # the stream only by call_control_id, which does not exist until the
        # dial returns, so registration happens there and not here.
        self.registry = registry if registry is not None else {}
        self.on_event = on_event or (lambda kind, text: None)

        self._q: queue.Queue[bytes] = queue.Queue(maxsize=400)
        self._ws = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._attached = threading.Event()
        self._answered = threading.Event()
        self._ended = threading.Event()
        self._play_until = 0.0
        self._hangup_cause: str | None = None
        self._recording = bytearray()

    # -- called by the server, from the event loop --------------------------

    def attach(self, ws, loop: asyncio.AbstractEventLoop) -> None:
        """The media websocket for this call has arrived."""
        self._ws = ws
        self._loop = loop
        self._attached.set()

    def feed(self, payload_b64: str) -> None:
        """One inbound media frame, straight off the websocket."""
        try:
            pcm8 = ulaw.decode(base64.b64decode(payload_b64))
        except Exception:
            return
        chunk = ulaw.upsample_2x(pcm8)
        if not chunk:
            return
        # Keep the far end's audio exactly as received, before any VAD or
        # draining touches it. When a call goes wrong the question is always
        # "what did it actually hear", and a transcript cannot answer that.
        self._recording.extend(pcm8)
        try:
            self._q.put_nowait(chunk)
        except queue.Full:
            # Drop the oldest rather than block the event loop, which would
            # stall every other call sharing it.
            try:
                self._q.get_nowait()
                self._q.put_nowait(chunk)
            except queue.Empty:
                pass

    def mark_answered(self) -> None:
        self._answered.set()

    def mark_ended(self, cause: str = "") -> None:
        self._hangup_cause = cause or self._hangup_cause
        self._ended.set()
        self._play_until = 0.0

    @property
    def ended(self) -> bool:
        return self._ended.is_set()

    def is_live(self) -> bool:
        return not self._ended.is_set()

    def save_recording(self, path) -> object | None:
        """Write the far end's audio, at the 8 kHz it actually arrived as."""
        if not self._recording:
            return None
        from pathlib import Path

        out = Path(path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(audio.wav_bytes(bytes(self._recording), rate=8000))
        return out

    # -- the Transport interface --------------------------------------------

    def dial(self, number: str) -> None:
        body = {
            "connection_id": config.key("TELNYX_CONNECTION_ID", required=True),
            "to": number,
            "from": self.from_number,
            "stream_url": config.key("TELNYX_STREAM_URL", required=True),
            "stream_track": "inbound_track",
            "stream_codec": "PCMU",
            "stream_bidirectional_mode": "rtp",
            "stream_bidirectional_codec": "PCMU",
            "stream_bidirectional_sampling_rate": 8000,
            # stream_bidirectional_target_legs is deliberately left at its
            # default of "opposite", which sends our audio to the party we
            # called. IF THE FAR END EVER HEARS SILENCE, THIS IS THE FIRST
            # THING TO CHANGE: "self" would play the audio back at our own leg
            # instead, which sounds like a dead line to them and perfect health
            # to us, because every other signal in the system stays green.
            # Keeps frames flowing through quiet stretches, so a silent line and
            # a dead line stay distinguishable.
            "send_silence_when_idle": True,
            # Ofcom requires an answered call to connect within 2 seconds and
            # requires at least 15 seconds of ring before abandoning it.
            "timeout_secs": config.TELNYX_RING_SECONDS,
        }
        data = _request("POST", "/calls", body).get("data", {})
        self.call_control_id = data.get("call_control_id")
        if not self.call_control_id:
            raise RuntimeError(f"Telnyx accepted the dial but returned no call id: {data}")
        self.registry[self.call_control_id] = self

        # The media websocket is a call BACK to us, so nothing can happen until
        # it lands. Without this wait the agent would start talking into a
        # transport that has nowhere to send audio.
        if not self._attached.wait(timeout=config.TELNYX_ATTACH_TIMEOUT_S):
            raise RuntimeError(
                "Telnyx never opened the media websocket. Check that "
                f"{config.key('TELNYX_STREAM_URL')} is reachable from the public internet."
            )

    def wait_for_audio(self, timeout_s: float = config.NO_AUDIO_TIMEOUT_S) -> bool:
        """True once the call is answered and real audio is flowing.

        Telnyx gives us an explicit `call.answered` webhook, which is a far
        better answer signal than the SIM rig's audio-onset heuristic. But
        `send_silence_when_idle` means frames arrive either way, so the audio
        gate stays as a second condition rather than the only one.
        """
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if self._ended.is_set():
                return False
            if self._answered.wait(timeout=0.2):
                break
        else:
            return False

        # Answered. Now wait for something other than comfort noise, so the
        # opener does not start playing into the first half second of a
        # connection that is still settling.
        consecutive = 0
        while time.time() < deadline:
            if self._ended.is_set():
                return False
            chunk = self.read(timeout=0.4)
            if chunk is None:
                continue
            if audio.rms_dbfs(chunk) > config.ANSWER_GATE_DBFS:
                consecutive += 1
                if consecutive >= config.ANSWER_ONSET_CHUNKS:
                    return True
            else:
                consecutive = 0
        # Answered but silent. Still a connected call, so treat it as answered
        # and let the conversation loop's own timeouts handle a dead line.
        return True

    def read(self, timeout: float = 0.5) -> bytes | None:
        try:
            return self._q.get(timeout=timeout)
        except queue.Empty:
            return None

    def drain(self) -> None:
        while True:
            try:
                self._q.get_nowait()
            except queue.Empty:
                return

    def baseline_level(self) -> float:
        levels = []
        while len(levels) < 12:
            chunk = self.read(timeout=0.1)
            if chunk is None:
                break
            levels.append(audio.rms_dbfs(chunk))
        if not levels:
            return -55.0
        levels.sort()
        return levels[len(levels) // 4]

    # -- talking back --------------------------------------------------------

    def _send(self, message: dict) -> None:
        """Hand a message to the websocket, from whatever thread we are on."""
        if self._ws is None or self._loop is None or self._ended.is_set():
            return
        try:
            asyncio.run_coroutine_threadsafe(
                self._ws.send_json(message), self._loop
            ).result(timeout=5)
        except Exception as e:
            self.on_event("error", f"media send failed: {e}")

    def speak(self, payload: bytes) -> None:
        """Play mu-law 8 kHz audio to the far end.

        The payload is already mu-law because the TTS is asked for it directly,
        so there is no transcoding step here and nothing to go wrong in it.
        """
        self.stop_speaking()
        if not payload:
            return
        step = int(ULAW_BYTES_PER_SECOND * SEND_CHUNK_MS / 1000)
        for i in range(0, len(payload), step):
            self._send({
                "event": "media",
                "media": {"payload": base64.b64encode(payload[i:i + step]).decode()},
            })
        self._play_until = time.monotonic() + len(payload) / ULAW_BYTES_PER_SECOND

    def is_speaking(self) -> bool:
        return not self._ended.is_set() and time.monotonic() < self._play_until

    def stop_speaking(self) -> None:
        """Flush whatever Telnyx still has queued for playback.

        This is what makes barge-in instant: the audio is already buffered on
        their side, so simply not sending more would let the AI keep talking
        over the prospect for seconds.
        """
        if self._play_until:
            self._send({"event": "clear"})
        self._play_until = 0.0

    # -- teardown ------------------------------------------------------------

    def hangup(self) -> None:
        self.stop_speaking()
        if not self.call_control_id or self._ended.is_set():
            return
        try:
            _request("POST", f"/calls/{self.call_control_id}/actions/hangup", {})
        except RuntimeError as e:
            # Already gone is not a failure. Telnyx answers 422 when the call
            # has ended on its own, which is the common case after a normal
            # goodbye, and raising there would mask real hangup failures.
            if "422" not in str(e):
                raise
        self._ended.set()

    def close(self) -> None:
        self._ended.set()
        self._play_until = 0.0

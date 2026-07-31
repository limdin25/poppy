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
import math
import os
import queue
import random
import threading
import time
import urllib.error
import urllib.request
from array import array

from . import audio, config, ulaw
from .transport import CaptureFailed, Transport

API = "https://api.telnyx.com/v2"

# mu-law at 8 kHz is exactly 8000 bytes per second, which makes playback
# duration arithmetic rather than a guess. That is how is_speaking() works
# without waiting for Telnyx to tell us anything.
ULAW_BYTES_PER_SECOND = 8000
# COMFORT NOISE. Hugo, on the silence between her turns: "it's like there was
# music going on and now there's a pause button."
#
# He is right, and this is a known problem with digital voice rather than
# anything we invented. A real phone line is never silent: there is always line
# hiss and room tone under the conversation, and the human ear uses it to know
# the call is still connected. When we send nothing at all the far end gets
# TRUE digital silence, which sounds like the line dropped, and every gap
# between her turns lands like a machine stopping rather than a person pausing.
#
# Telephony has solved this for decades. G.711 has no built-in comfort noise
# generator (that is a G.729 feature), so on a mu-law leg it has to be sent.
# Very quiet, around -50 dBFS, which is far below the barge-in margin so it can
# never be mistaken for the prospect speaking, even after it echoes off their
# handset.
# Hugo: "put office sound in the background". Flat white noise is hiss, not a
# room. A room is weighted LOW: air handling, traffic through a window, the
# building itself, all under a few hundred hertz, with the level wandering
# slowly rather than sitting still. So the noise is low-passed into room tone
# and given a slow drift, which is the difference between "somebody is in an
# office" and "the line is faulty".
#
# This is SYNTHESISED room tone, not a recording of an office. It will not give
# you keyboards or a colleague laughing. If a real ambience recording is wanted,
# an 8 kHz mu-law loop dropped in here would replace it directly.
# MEASURED PER VOICE, never tuned by ear: render a long sentence with the
# live voice, take the quietest 200ms window, and match it. The room between
# her turns has to be the same room her voice was recorded in: quieter reads
# as the line dying whenever she stops, louder reads as hiss barging in.
# History: -36.2 on voice d875..., -48.8 on 690813f2..., -52.8 on
# 9335631..., -45.1 on 5a03c684... which is the live one. Override with
# BRIDGE_COMFORT_DBFS when the voice changes, then move the default.
COMFORT_NOISE_DBFS = float(os.environ.get("BRIDGE_COMFORT_DBFS", "-45"))
# The under-voice mixing is OFF by default since 2026-07-31: the voice model
# carries its OWN reference room while speaking, and adding ours on top
# doubled the noise during speech, which Hugo heard as "background noise is
# too high". With the between-turns floor MATCHED to the voice's measured
# floor, the room is continuous without any mixing. The machinery stays for
# a voice whose own floor is too quiet to hear: BRIDGE_MIX_ROOM_TONE=1.
MIX_ROOM_TONE = os.environ.get("BRIDGE_MIX_ROOM_TONE", "0") == "1"
COMFORT_CHUNK_MS = 200
# How much of the previous sample carries into the next one. Higher is duller
# and more distant. 0.92 puts most of the energy under about 300 Hz, which is
# where room rumble actually lives.
COMFORT_SMOOTHING = 0.92
# How much audio to put in one websocket frame. Telnyx accepts 20ms to 30s.
SEND_CHUNK_MS = 200


class RoomTone:
    """The synthesised room tone generator, stateful so the joins are seamless.

    One instance per call, shared between the between-turns comfort frames and
    the under-the-voice mixing, so the filter state and the slow drift carry
    across every boundary and there is never a click or a level jump where one
    source hands over to the other.
    """

    def __init__(self) -> None:
        self._prev = 0.0
        self._phase = 0.0

    def samples(self, n: int) -> list[int]:
        base = (10 ** (COMFORT_NOISE_DBFS / 20.0)) * 32767.0
        # A slow wander of a couple of dB, so it is never quite static.
        self._phase += 0.13 * (n / 1600.0)
        drift = 10 ** ((1.5 * math.sin(self._phase)) / 20.0)
        a = COMFORT_SMOOTHING
        # A one-pole low pass loses energy, so put it back to keep the measured
        # level on target rather than 20 dB under it.
        gain = base * drift * math.sqrt((1 + a) / (1 - a))
        prev = self._prev
        out = []
        for _ in range(n):
            prev = a * prev + (1 - a) * random.gauss(0.0, 1.0)
            v = int(prev * gain)
            out.append(-32768 if v < -32768 else (32767 if v > 32767 else v))
        self._prev = prev
        return out


def mix_room_tone(tone: RoomTone, payload: bytes) -> bytes:
    """The room tone mixed UNDER a mu-law voice payload.

    Telnyx plays our frames strictly in sequence, one stream, so the tone
    cannot be sent alongside the voice: a comfort frame sent mid-reply would
    queue AFTER the speech and delay it. The only way the ambient floor
    survives her talking is to be part of the voice audio itself. Without
    this, the room went dead the instant she spoke and came back when she
    stopped, which is the exact "pause button" tell Hugo reported twice.

    At -48 dBFS under a -18 dBFS voice the ear cannot hear the addition on
    the speech itself; what it hears is the silence between her sentences no
    longer being the silence of a dead line.
    """
    pcm = array("h")
    pcm.frombytes(ulaw.decode(payload))
    for i, nz in enumerate(tone.samples(len(pcm))):
        v = pcm[i] + nz
        pcm[i] = -32768 if v < -32768 else (32767 if v > 32767 else v)
    return ulaw.encode(pcm.tobytes())


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
        # Set from the call.machine.detection.ended webhook. The Event is what
        # the call loop watches; the string is kept for the ledger, so a batch
        # can be read back as "how many were answerphones" afterwards.
        self._machine = threading.Event()
        self._machine_result: str | None = None
        self._recording = bytearray()
        # True while a stream feeder is running, so is_speaking() stays true
        # in the gap before the first chunk of a streamed reply arrives.
        self._streaming = False
        # When sound actually started reaching the far end (see audio_started_at).
        self._audio_began = 0.0
        # Optional tap on the raw inbound mu-law, before any decoding.
        # Used to fork audio to the live transcriber.
        self.listener = None
        # Keeps the line sounding alive between her turns. See COMFORT_NOISE.
        self._comfort_stop = threading.Event()
        self._comfort: threading.Thread | None = None
        # ONE generator for the whole call, shared by the comfort frames and
        # the under-the-voice mixing, so the floor is continuous across every
        # speaking/listening boundary.
        self._tone = RoomTone()

    # -- called by the server, from the event loop --------------------------

    def attach(self, ws, loop: asyncio.AbstractEventLoop) -> None:
        """The media websocket for this call has arrived."""
        self._ws = ws
        self._loop = loop
        self._attached.set()

    # -- comfort noise -------------------------------------------------------

    def _comfort_frame(self) -> bytes:
        """A chunk of room tone, as mu-law.

        Generated fresh each time rather than looped: a repeating 200ms of the
        same noise is audible as a tick once you have noticed it, and once you
        notice it you cannot stop hearing it.

        Low-passed, because a room is not hiss. The generator's filter state
        carries across frames, and across the under-the-voice mixing too, so
        there is no click at any join and the level drifts slowly enough to
        breathe instead of sitting flat.
        """
        pcm = array("h", self._tone.samples(8000 * COMFORT_CHUNK_MS // 1000))
        return ulaw.encode(pcm.tobytes())

    def _start_comfort_noise(self) -> None:
        if self._comfort is not None:
            return

        def run() -> None:
            # Real time, or the far end's jitter buffer fills up and the noise
            # arrives in bursts long after it was sent.
            step = COMFORT_CHUNK_MS / 1000.0
            while not self._comfort_stop.is_set() and not self._ended.is_set():
                # Re-checked immediately before the send, not just at the top of
                # the loop: a call can end mid-wait, and audio arriving after
                # hangup is exactly what the tests refuse to allow.
                if (self._ended.is_set() or not self._answered.is_set()
                        or self.is_speaking()):
                    # A short poll, not a full frame's worth. Waiting 200ms here
                    # left up to 200ms of true dead air after every reply, which
                    # is long enough to hear as a drop-out.
                    self._comfort_stop.wait(0.05)
                    continue
                if True:
                    # Straight out, NOT through _send_audio: that stamps
                    # _audio_began, which is how the barge-in grace window and
                    # the "how much did they hear" estimate are timed. Comfort
                    # noise must be invisible to both.
                    self._send({
                        "event": "media",
                        "media": {"payload": base64.b64encode(
                            self._comfort_frame()).decode()},
                    })
                self._comfort_stop.wait(step)

        self._comfort = threading.Thread(target=run, daemon=True)
        self._comfort.start()

    def feed(self, payload_b64: str) -> None:
        """One inbound media frame, straight off the websocket."""
        try:
            raw = base64.b64decode(payload_b64)
        except Exception:
            return
        # Fork the UNTOUCHED mu-law to the transcriber. Telnyx carries exactly
        # the format AssemblyAI wants, and their docs are explicit that
        # upsampling telephony audio degrades accuracy, so nothing is converted
        # on this path at all.
        if self.listener is not None:
            self.listener(raw)
        try:
            pcm8 = ulaw.decode(raw)
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
        # Only once somebody has actually picked up. Started on attach it ran
        # while the phone was still ringing, and the end-to-end tests caught it
        # sending into a call that had already hung up.
        self._start_comfort_noise()

    def mark_ended(self, cause: str = "") -> None:
        self._hangup_cause = cause or self._hangup_cause
        self._ended.set()
        self._play_until = 0.0
        self._comfort_stop.set()

    def mark_machine(self, result: str) -> None:
        """Telnyx has decided what picked up. Only "machine" stops the call.

        "not_sure" and "silence" deliberately do NOT count. A false positive
        here hangs up on a real plumber mid-sentence, which is far worse than
        the thing it is trying to save: talking to a machine costs a minute of
        API time, hanging up on a human costs the lead and looks like a
        malfunctioning robocall. So this fails towards keeping the call.
        """
        self._machine_result = result
        if str(result).lower() == "machine":
            self._machine.set()

    @property
    def machine_result(self) -> str | None:
        return self._machine_result

    def is_machine(self) -> bool:
        return self._machine.is_set()

    @property
    def ended(self) -> bool:
        return self._ended.is_set()

    @property
    def hangup_cause(self) -> str | None:
        """Telnyx's word for why the call ended, once it has told us.

        Worth recording on a campaign: "call_rejected" and "user_busy" are a
        person declining, while "timeout" is nobody there, and the three want
        different follow-up.
        """
        return self._hangup_cause or None

    def is_live(self) -> bool:
        return not self._ended.is_set()

    # -- interruption tuning -------------------------------------------------
    # We subscribe to inbound_track only, so the audio arriving here is the far
    # end and nothing else. Our own voice is never in it. That removes the whole
    # reason the SIM rig needs a long grace window and a 26 dB margin, and those
    # defaults measured badly on the first live call: they made interrupting
    # require more than two seconds of continuous talking, which nobody does, so
    # the agent talked straight over the prospect for 96 seconds.
    #
    # What is left to guard against is acoustic echo at THEIR end, a speakerphone
    # in a van carrying our voice back through their microphone.
    #
    # 2026-07-29: this was underestimated, badly, and a "modest margin" was NOT
    # enough. On a live call she said "Brilliant. So you're hearing me work
    # right" and it came back as a transcribed turn reading "Brilliant. So
    # you're hearing me work, right?", which she then answered. Clean enough to
    # transcribe verbatim means clean enough to trip a 14 dB interrupt as well,
    # and it also meant the prosody reader was measuring her own intonation.
    # Three separate symptoms, one wrong assumption. See Agent._own_echo.

    # Read from config rather than hardcoded, so the sliders on the agent page
    # actually reach a live call. They used to be literals here while the
    # settings page offered a control for them, which is the same dead-wiring
    # bug the emotion toggles had: saved in Supabase, read by nobody.

    @property
    def barge_grace_ms(self) -> float:
        # Just enough to cover the tail of the previous sentence still playing out.
        return config.TELNYX_BARGE_GRACE_MS

    @property
    def barge_margin_db(self) -> float:
        return config.TELNYX_BARGE_MARGIN_DB

    @property
    def barge_min_ms(self) -> float:
        # Long enough to ignore a cough or a line click, short enough that
        # "sorry, hang on" stops her before she finishes the next word.
        return config.TELNYX_BARGE_MS

    @property
    def echo_settle_ms(self) -> float:
        # Nothing to settle: there is no echo path back into our own capture.
        return 60.0

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
        # ANSWERPHONE DETECTION.
        #
        # Proved necessary on the first US batch: one of two calls was Atlas
        # Plumbing's voicemail, and Maria pitched to it for fifty-four seconds
        # and then filed it as "completed". At normal cold-call pickup rates
        # that is roughly half of every batch, so without this the campaign
        # spends most of its money talking to machines and the results table
        # says the conversations went fine.
        #
        # Telnyx classifies on its own leg, in parallel, and tells us over the
        # webhook. It costs a HUMAN nothing, which is the whole reason for
        # using theirs rather than waiting on our own transcript: we still say
        # the opener immediately, and only a machine gets hung up on.
        if config.AMD_ENABLED:
            body["answering_machine_detection"] = config.AMD_MODE
        data = _request("POST", "/calls", body).get("data", {})
        self.call_control_id = data.get("call_control_id")
        if not self.call_control_id:
            raise RuntimeError(f"Telnyx accepted the dial but returned no call id: {data}")
        self.registry[self.call_control_id] = self
        # Deliberately does NOT wait for the media websocket here.
        #
        # Telnyx opens that socket when the call is ANSWERED, not when it is
        # placed. Blocking on it inside dial() therefore turns "they took a
        # while to pick up" into a hard error, which is exactly what happened on
        # a live call: a 20 second wait fired while the phone was still ringing
        # and reported it as an unreachable websocket. Waiting for the far end
        # is wait_for_audio()'s job, and it already knows the difference between
        # nobody answering and something being broken.

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

        # Answered. The media socket opens at that moment, so give it a few
        # seconds to land. If it never does, THAT is a genuine rig failure and
        # deserves to be shouted about rather than logged as a no-answer.
        if not self._attached.wait(timeout=config.TELNYX_ATTACH_TIMEOUT_S):
            raise CaptureFailed(
                "the call was answered but Telnyx never opened the media "
                f"websocket. Check {config.key('TELNYX_STREAM_URL')} is reachable."
            )

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
        # Six chunks, not twelve. This runs between them answering and the
        # opener starting, so every chunk read here is silence they are sitting
        # through. Six is about 130ms and plenty to measure a line level.
        levels = []
        while len(levels) < 6:
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
        self._send_audio(payload)
        self._play_until = time.monotonic() + len(payload) / ULAW_BYTES_PER_SECOND

    def speak_stream(self, chunks) -> None:
        """Play audio as it is produced, rather than waiting for the whole clip.

        Returns as soon as the feeder is running, so the barge-in loop upstairs
        starts watching immediately. `_streaming` keeps is_speaking() true in the
        gap before the first chunk lands, or the loop would see a silent
        transport and conclude she had already finished.
        """
        self.stop_speaking()
        if self._ended.is_set():
            return
        self._streaming = True

        def feed() -> None:
            try:
                for chunk in chunks:
                    if self._ended.is_set() or not self._streaming:
                        break            # barge-in, stop pulling from the model
                    self._send_audio(chunk)
                    now = time.monotonic()
                    self._play_until = max(self._play_until, now) + len(chunk) / ULAW_BYTES_PER_SECOND
            except Exception as e:
                self.on_event("error", f"voice stream failed: {e}")
            finally:
                self._streaming = False

        threading.Thread(target=feed, daemon=True).start()

    def audio_started_at(self) -> float:
        """When sound actually began leaving for the far end, 0 if not yet.

        The barge-in grace window has to be measured from THIS, not from when we
        asked to speak. With streaming those are different moments: speak_stream
        returns instantly and the first chunk arrives about 300ms later, so a
        grace window started at the request had already expired before she made
        a sound, and the first noise on the line cut off an opener that had not
        begun. Measured on a live call: barge-in fired one second after answer,
        every time.
        """
        return self._audio_began

    def _send_audio(self, payload: bytes) -> None:
        if not self._audio_began:
            self._audio_began = time.monotonic()
        # Only when explicitly enabled: on a voice that carries its own
        # reference room, adding ours on top doubles the noise under speech.
        if MIX_ROOM_TONE:
            payload = mix_room_tone(self._tone, payload)
        step = int(ULAW_BYTES_PER_SECOND * SEND_CHUNK_MS / 1000)
        for i in range(0, len(payload), step):
            self._send({
                "event": "media",
                "media": {"payload": base64.b64encode(payload[i:i + step]).decode()},
            })

    def is_speaking(self) -> bool:
        if self._ended.is_set():
            return False
        return self._streaming or time.monotonic() < self._play_until

    def stop_speaking(self) -> None:
        """Flush whatever Telnyx still has queued for playback.

        This is what makes barge-in instant: the audio is already buffered on
        their side, so simply not sending more would let the AI keep talking
        over the prospect for seconds.
        """
        # Order matters: stop the feeder BEFORE the clear, or it keeps pushing
        # new audio into the queue we just emptied and she talks on regardless.
        was_active = self._streaming or self._play_until
        self._streaming = False
        self._audio_began = 0.0
        if was_active:
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

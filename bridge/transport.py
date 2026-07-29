"""Call transports.

A transport places a call, streams the far end's audio in, and plays audio back
so the far end hears it. Everything above this layer is transport-agnostic, so
the SIM rig and a VoIP trunk are interchangeable.

SimTransport is the one proven working on 2026-07-28 against a stock, unrooted
Samsung Galaxy A16 over wireless adb, with nothing bought.
"""
from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from . import audio, config


class CaptureFailed(RuntimeError):
    """The audio capture pipeline died, so we are talking into a void.

    Distinct from "nobody answered" on purpose. Both used to look identical: a
    scrcpy that failed to start left a real prospect's phone ringing for the
    full 45 second timeout and the run then reported a clean no_answer.
    """


class Transport:
    """Interface every call transport implements.

    Everything above this layer talks only to these methods, with no isinstance
    checks anywhere. That is load-bearing rather than tidiness: the conversation
    loop used to ask `isinstance(transport, SimTransport)` before running the
    barge-in wait, so any other transport would have skipped it silently and
    started listening while the AI was still mid-sentence.
    """

    def prepare(self) -> None:
        """Anything the device needs before dialling. Default: nothing."""

    def dial(self, number: str) -> None:
        raise NotImplementedError

    def wait_for_audio(self, timeout_s: float) -> bool:
        """Block until the far end is actually connected. True if it answered."""
        raise NotImplementedError

    def read(self, timeout: float = 0.5) -> bytes | None:
        """Next chunk of far-end audio, 16 kHz mono 16-bit. None if nothing yet."""
        raise NotImplementedError

    def speak(self, payload: bytes) -> None:
        """Start playing audio to the far end. Returns as soon as it is queued."""
        raise NotImplementedError

    def is_speaking(self) -> bool:
        """Is our audio still playing? Drives the barge-in wait."""
        return False

    def stop_speaking(self) -> None:
        raise NotImplementedError

    def drain(self) -> None:
        """Throw away buffered far-end audio. Default: nothing is buffered."""

    def baseline_level(self) -> float:
        """The line's own quiet level in dBFS, used to seed the VAD."""
        return -55.0

    # -- interruption tuning, per transport ---------------------------------
    # These defaults exist to survive the SIM rig, where the far end's handset
    # echoes our own voice back down the line and a hair trigger makes the agent
    # cut itself off mid-sentence. A transport that cannot hear its own voice
    # should override them hard, because on that path every one of these is pure
    # delay: measured on a live Telnyx call, the combination made interrupting
    # take over two seconds of solid talking, so a real person simply could not
    # do it and was talked over for the whole call.

    @property
    def barge_grace_ms(self) -> float:
        """Ignore everything for this long after starting to speak."""
        return config.BARGE_IN_GRACE_MS

    @property
    def barge_margin_db(self) -> float:
        """How far above the noise floor counts as the prospect, not our echo."""
        return config.BARGE_IN_MARGIN_DB

    @property
    def barge_min_ms(self) -> float:
        """How long they must keep talking before we treat it as an interruption."""
        return config.BARGE_IN_MS

    @property
    def echo_settle_ms(self) -> float:
        """Pause after speaking, to let our own echo pass before listening."""
        return config.ECHO_SETTLE_MS

    def is_live(self) -> bool:
        """False once the far end is definitively gone.

        Transports that get told about a hangup should say so, rather than
        leaving the conversation loop to infer it from silence. Inferring costs
        real seconds on every call: the loop has to wait out two quiet rounds
        before giving up, which is roughly nine seconds of nobody being there.
        """
        return True

    def hangup(self) -> None:
        raise NotImplementedError

    def close(self) -> None:
        pass


class SimTransport(Transport):
    """Android phone holding a physical SIM, driven over wireless adb.

    Audio in  : scrcpy captures the call downlink and writes raw PCM to a FIFO.
    Audio out : played through the computer's speaker into the phone's mic.

    The outgoing half being acoustic is what makes this work with no root, and
    also what stops it scaling past one call per machine. Sound has no channels.
    """

    def __init__(self, serial: str | None = None):
        self.serial = serial or self._first_device()
        if not self.serial:
            raise RuntimeError(
                "No adb device. Enable Wireless debugging on the phone, then:\n"
                "  adb mdns services       (find the pairing port)\n"
                "  adb pair <ip:port> <code>\n"
                "  adb connect <ip:port>"
            )
        self._scrcpy: subprocess.Popen | None = None
        self._player: subprocess.Popen | None = None
        self._fifo: str | None = None
        self._tmpdir: str | None = None
        self._q: queue.Queue[bytes] = queue.Queue(maxsize=400)
        self._reader: threading.Thread | None = None
        self._stop = threading.Event()
        self._head = bytearray()
        self._header_done = False
        self._log_path: str | None = None
        self._prior_volume: int | None = None

    # -- device plumbing ----------------------------------------------------

    @staticmethod
    def _first_device() -> str | None:
        try:
            out = subprocess.run(
                ["adb", "devices"], capture_output=True, text=True, timeout=15
            ).stdout
        except Exception:
            return None
        for line in out.splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 2 and parts[1] == "device":
                return parts[0]
        return None

    def _adb(self, *args: str, timeout: int = 20, check: bool = True) -> str:
        """Run an adb command. Raises on failure unless check is False.

        The return code used to be ignored entirely, which is how a failed
        KEYCODE_ENDCALL could leave a live call connected with nobody on it
        while the console printed a tidy "completed".
        """
        p = subprocess.run(
            ["adb", "-s", self.serial, *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if check and p.returncode != 0:
            detail = (p.stderr or p.stdout).strip()[:200]
            raise RuntimeError(f"adb {' '.join(args)} failed ({p.returncode}): {detail}")
        return p.stdout

    def device_info(self) -> dict[str, str]:
        props = ["ro.product.model", "ro.build.version.release", "ro.soc.model"]
        return {
            p: self._adb("shell", "getprop", p, check=False).strip() for p in props
        }

    def call_state(self) -> int:
        """0 idle, 1 ringing, 2 offhook, -1 unknown because adb failed.

        Warning, learned the hard way: this hits 2 within about two seconds of
        dialling, long before anyone answers. It is useless as an answer signal.
        Use wait_for_audio() instead, which watches for real audio. It is still
        the only way to confirm a call actually ended.

        -1 rather than 0 on failure matters: this is used to verify a hangup, so
        reporting "idle" when we simply could not ask would fail open on exactly
        the case worth catching.
        """
        try:
            out = self._adb("shell", "dumpsys", "telephony.registry")
        except Exception:
            return -1
        for line in out.splitlines():
            if "mCallState" in line:
                digits = "".join(c for c in line if c.isdigit())
                return int(digits[0]) if digits else 0
        return 0

    # -- the call -----------------------------------------------------------

    def dial(self, number: str) -> None:
        self._adb(
            "shell", "am", "start", "-a", "android.intent.action.CALL",
            "-d", f"tel:{number}",
        )
        self._start_capture()

    def _start_capture(self) -> None:
        self._tmpdir = tempfile.mkdtemp(prefix="elsie-bridge-")
        self._fifo = os.path.join(self._tmpdir, "downlink.wav")
        self._log_path = os.path.join(self._tmpdir, "scrcpy.log")
        os.mkfifo(self._fifo)
        self._head = bytearray()
        self._header_done = False

        # scrcpy's stderr is kept, not discarded. When capture fails it is the
        # only thing that says why, and a silent failure here is indistinguishable
        # from a prospect who did not pick up.
        self._scrcpy = subprocess.Popen(
            [
                "scrcpy", "-s", self.serial,
                "--no-video", "--no-playback",
                "--audio-codec=raw",
                "--audio-source=voice-call-downlink",
                f"--record={self._fifo}",
                "--record-format=wav",
                f"--time-limit={config.MAX_CALL_SECONDS}",
            ],
            stdout=subprocess.DEVNULL,
            stderr=open(self._log_path, "wb"),
        )
        self._reader = threading.Thread(target=self._pump, daemon=True)
        self._reader.start()

    def _strip_header(self, raw: bytes) -> bytes:
        """Drop the WAV header, however long it happens to be.

        It is not 44 bytes. scrcpy sets a comment tag and does not set
        AVFMT_FLAG_BITEXACT, so libavformat writes a LIST/INFO chunk as well and
        the real header runs to about 110. Skipping a fixed 44 fed roughly 66
        bytes of ASCII header text into the pipeline as PCM, where it measures
        about -21 dBFS. That is 48 dB above the answer gate, so every call
        "answered" on its first chunk and the opener played into a ringing phone.

        So find the "data" chunk instead of trusting any length. Returns b"" while
        still waiting for it.
        """
        self._head.extend(raw)
        # Search past "RIFF....WAVE" so a stray "data" in the comment text cannot
        # match ahead of the real chunk id.
        idx = self._head.find(b"data", 12)
        if idx < 0 or len(self._head) < idx + 8:
            if len(self._head) > config.MAX_WAV_HEADER_BYTES:
                raise OSError("no WAV data chunk found in the capture stream")
            return b""
        body = bytes(self._head[idx + 8:])
        self._head = bytearray()
        self._header_done = True
        return body

    def _pump(self) -> None:
        """Read the FIFO, convert to 16 kHz mono, hand chunks to the queue."""
        try:
            fd = os.open(self._fifo, os.O_RDONLY)
        except OSError:
            return
        try:
            while not self._stop.is_set():
                raw = os.read(fd, 4096)
                if not raw:
                    break
                if not self._header_done:
                    raw = self._strip_header(raw)
                    if not raw:
                        continue
                chunk = audio.to_mono_16k(raw)
                if chunk:
                    try:
                        self._q.put_nowait(chunk)
                    except queue.Full:
                        # Drop the oldest rather than block the reader, or the
                        # FIFO backs up and scrcpy stalls.
                        try:
                            self._q.get_nowait()
                            self._q.put_nowait(chunk)
                        except queue.Empty:
                            pass
        except OSError:
            pass
        finally:
            try:
                os.close(fd)
            except OSError:
                pass

    def stream_alive(self) -> bool:
        """Is the capture pipeline still running?"""
        return self._scrcpy is not None and self._scrcpy.poll() is None

    def capture_error(self) -> str:
        """Whatever scrcpy complained about before it died."""
        if not self._log_path:
            return ""
        try:
            return Path(self._log_path).read_text(errors="ignore").strip()[-400:]
        except OSError:
            return ""

    def wait_for_audio(self, timeout_s: float = config.NO_AUDIO_TIMEOUT_S) -> bool:
        """Detect a real answer by watching for audio, not by asking Android.

        Ringback is not captured on the downlink, so the line stays at digital
        silence while it rings and real audio appears the moment someone picks
        up. That makes audio onset a precise, free answer signal.

        Onset has to be sustained. rms is a mean over the chunk, so one sample at
        half a percent of full scale in a 21ms window clears the gate on its own,
        and a false answer means the opener is delivered to a ringing phone.

        Raises CaptureFailed rather than quietly waiting out the timeout when the
        capture pipeline is dead, because that is a broken rig, not a no-answer.
        """
        deadline = time.time() + timeout_s
        consecutive = 0
        while time.time() < deadline:
            if not self.stream_alive():
                raise CaptureFailed(
                    f"scrcpy exited before any audio arrived. {self.capture_error()}"
                )
            chunk = self.read(timeout=0.4)
            if not chunk:
                consecutive = 0
                continue
            if audio.rms_dbfs(chunk) > config.ANSWER_GATE_DBFS:
                consecutive += 1
                if consecutive >= config.ANSWER_ONSET_CHUNKS:
                    return True
            else:
                consecutive = 0
        return False

    def baseline_level(self) -> float:
        """The line's own quiet level, measured from whatever is buffered.

        Used to seed the VAD from this call rather than from a hardcoded guess.
        """
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

    def read(self, timeout: float = 0.5) -> bytes | None:
        try:
            return self._q.get(timeout=timeout)
        except queue.Empty:
            return None

    def drain(self) -> None:
        """Throw away buffered audio, so the AI does not hear its own echo."""
        while True:
            try:
                self._q.get_nowait()
            except queue.Empty:
                return

    # -- talking back -------------------------------------------------------

    def prepare(self) -> None:
        self.set_volume(config.SPEAKER_VOLUME)

    @staticmethod
    def _osa(script: str) -> str:
        p = subprocess.run(
            ["osascript", "-e", script], capture_output=True, text=True
        )
        return p.stdout.strip() if p.returncode == 0 else ""

    def set_volume(self, percent: int) -> None:
        """Set the speaker level, remembering what it was so close() can put it back.

        Also unmutes. A muted Mac sends the entire AI half of the call nowhere,
        silently, while the console prints ELSIE lines as though they were spoken
        and the paid STT, LLM and TTS loop carries on running.
        """
        if self._prior_volume is None:
            prior = self._osa("output volume of (get volume settings)")
            if prior.isdigit():
                self._prior_volume = int(prior)
        self._osa(f"set volume output volume {percent} without output muted")

    def default_output(self) -> str:
        """Name of the speaker the AI's voice will actually come out of.

        afplay always plays to the system default. If that is a paired headset,
        the phone's microphone hears nothing and the prospect sits in silence
        while the console happily prints everything Elsie "said".
        """
        try:
            raw = subprocess.run(
                ["system_profiler", "-json", "SPAudioDataType"],
                capture_output=True, text=True, timeout=20,
            ).stdout
            data = json.loads(raw)
        except Exception:
            return ""

        def walk(node):
            if isinstance(node, dict):
                if node.get("coreaudio_default_audio_output_device") == "spaudio_yes":
                    return node.get("_name", "")
                for value in node.values():
                    found = walk(value)
                    if found:
                        return found
            elif isinstance(node, list):
                for item in node:
                    found = walk(item)
                    if found:
                        return found
            return ""

        return walk(data)

    def speak(self, payload: bytes) -> None:
        """Play audio out of the computer speaker, into the phone's microphone."""
        self.stop_speaking()
        suffix = ".mp3" if payload[:3] == b"ID3" or payload[:2] == b"\xff\xfb" else ".wav"
        path = Path(self._tmpdir or tempfile.gettempdir()) / f"say{suffix}"
        path.write_bytes(payload)
        self._player = subprocess.Popen(
            ["afplay", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )

    def is_speaking(self) -> bool:
        return self._player is not None and self._player.poll() is None

    def stop_speaking(self) -> None:
        if self._player and self._player.poll() is None:
            self._player.terminate()
            try:
                self._player.wait(timeout=1)
            except subprocess.TimeoutExpired:
                self._player.kill()
        self._player = None

    # -- teardown -----------------------------------------------------------

    def hangup(self) -> None:
        """End the call, then confirm it actually ended.

        Confirming is the point. adb failures used to be swallowed whole, so a
        keyevent that never landed left a real cellular call connected with
        nobody on it, billing by the minute, while the console printed a clean
        "completed" and saved a tidy transcript.
        """
        self.stop_speaking()
        last_error = ""
        for attempt in range(6):
            try:
                if attempt % 2 == 0:
                    self._adb("shell", "input", "keyevent", "KEYCODE_ENDCALL")
                else:
                    # ITelephony.endCall, a different route to the same place, in
                    # case the keyevent is going to a window that ignores it.
                    self._adb("shell", "service", "call", "phone", "5")
            except Exception as e:
                last_error = str(e)
            time.sleep(0.4)
            if self.call_state() == 0:
                return
        raise RuntimeError(
            "the call may still be connected, check the phone. " + last_error
        )

    def close(self) -> None:
        self._stop.set()
        self.stop_speaking()
        if self._prior_volume is not None:
            self._osa(f"set volume output volume {self._prior_volume}")
            self._prior_volume = None
        if self._scrcpy and self._scrcpy.poll() is None:
            self._scrcpy.terminate()
            try:
                self._scrcpy.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self._scrcpy.kill()
        if self._tmpdir:
            shutil.rmtree(self._tmpdir, ignore_errors=True)
        self._tmpdir = None
        self._fifo = None
        self._log_path = None

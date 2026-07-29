"""Audio helpers: format conversion and voice activity detection.

Deliberately dependency-free. Python 3.13 removed `audioop`, and pulling numpy
in for a 3:1 decimation is not worth it.
"""
from __future__ import annotations

import array
import math
from collections import deque

from . import config


def to_mono_16k(chunk: bytes) -> bytes:
    """48 kHz stereo signed 16-bit -> 16 kHz mono signed 16-bit.

    Averages the two channels, then takes every third frame. 48000/16000 is
    exactly 3, so this is a clean decimation with no interpolation needed.
    """
    if not chunk:
        return b""
    # An odd trailing byte would desync the whole stream, so drop it.
    if len(chunk) % 4:
        chunk = chunk[: len(chunk) - (len(chunk) % 4)]
    samples = array.array("h")
    samples.frombytes(chunk)

    out = array.array("h")
    # Step 6 = 3 stereo frames (2 samples each), keeping one mono sample.
    for i in range(0, len(samples) - 1, 6):
        out.append((samples[i] + samples[i + 1]) // 2)
    return out.tobytes()


def rms_dbfs(pcm: bytes) -> float:
    """Loudness of a 16-bit mono chunk, in dBFS. Digital silence is -inf."""
    if len(pcm) < 2:
        return -99.0
    samples = array.array("h")
    samples.frombytes(pcm[: len(pcm) - (len(pcm) % 2)])
    if not samples:
        return -99.0
    total = 0
    for s in samples:
        total += s * s
    mean = total / len(samples)
    if mean <= 0:
        return -99.0
    return 20 * math.log10(math.sqrt(mean) / 32768.0)


def ms_of(pcm: bytes, rate: int = config.AI_RATE) -> float:
    """How many milliseconds of audio a 16-bit mono buffer holds."""
    return (len(pcm) / config.SAMPLE_WIDTH) / rate * 1000.0


class VoiceActivity:
    """Energy-gate VAD with an adaptive noise floor.

    A fixed threshold does not survive real phone lines, whose noise floor moves
    between calls and within them. This tracks the quiet level and treats
    anything a margin above it as speech.

    The floor is a rolling low percentile of recent levels, updated on EVERY
    chunk. That detail is the whole point, and getting it wrong was a real bug:
    the floor used to be updated only on the not-speech branch, so it could
    never rise past its own gate. Any line whose ambient level sat above the
    threshold, which is a van hands-free, a workshop, or a speakerphone, latched
    the VAD on permanently. End-of-turn silence was then never detected and the
    prospect was left on a silent line until the seven minute cap.

    A percentile rather than a mean or a minimum, because it has to tell steady
    noise from speech. Steady noise sits at one level, so its low percentile is
    that level and the floor correctly rises to meet it. Speech is full of gaps
    between words, so its low percentile stays down near the line's real quiet
    level and the floor does not chase the talker.

    Not as good as Silero, but it has no dependencies and no model to load,
    which matters for the first working version. Swappable later.
    """

    WINDOW_MS = 4000.0
    FLOOR_PERCENTILE = 0.10
    # Clamps, so the gate can never end up absurdly placed. Without the lower
    # clamp a digitally silent line (-99 dBFS) would drag the floor to the
    # bottom and make line hiss read as speech.
    FLOOR_MIN = -75.0
    FLOOR_MAX = -25.0
    # Longest run we will believe is somebody talking. While a run is shorter
    # than this the floor is held down, so the gate does not creep up and cut a
    # talker off mid-sentence. Past it, nobody speaks that long without a gap,
    # so it is the line itself and the floor is released to rise and meet it.
    # This is the escape hatch that bounds the old latch-forever bug: worst case
    # is now a turn that ends about a second late, not one that never ends.
    LATCH_MS = 4000.0

    def __init__(self, margin_db: float = 12.0, floor_start: float = -55.0):
        self.margin_db = margin_db
        self.noise_floor = floor_start
        self.speaking = False
        self._speech_ms = 0.0
        self._silence_ms = 0.0
        # Seeded, so the very first chunk is not compared against only itself,
        # which would make the floor equal the level and nothing ever speech.
        self._window: deque[tuple[float, float]] = deque([(floor_start, 1.0)])
        self._window_ms = 1.0

    def feed(self, pcm: bytes) -> tuple[bool, float, float]:
        """Returns (is_speech_now, continuous_speech_ms, continuous_silence_ms)."""
        level = rms_dbfs(pcm)
        duration = ms_of(pcm)

        self._window.append((level, duration))
        self._window_ms += duration
        while self._window_ms > self.WINDOW_MS and len(self._window) > 1:
            self._window_ms -= self._window.popleft()[1]

        ordered = sorted(lvl for lvl, _ in self._window)
        idx = min(int(len(ordered) * self.FLOOR_PERCENTILE), len(ordered) - 1)
        measured = max(self.FLOOR_MIN, min(self.FLOOR_MAX, ordered[idx]))

        if 0.0 < self._speech_ms < self.LATCH_MS:
            # Mid-run: the floor may fall but not rise, so a steady talker cannot
            # drag their own gate up over their own voice.
            self.noise_floor = min(self.noise_floor, measured)
        else:
            self.noise_floor = measured

        is_speech = level > self.noise_floor + self.margin_db
        if is_speech:
            self._speech_ms += duration
            self._silence_ms = 0.0
        else:
            self._silence_ms += duration
            self._speech_ms = 0.0

        self.speaking = is_speech
        return is_speech, self._speech_ms, self._silence_ms

    def calibrate(self, level_dbfs: float) -> None:
        """Seed the floor from a measured line level.

        Starting from a hardcoded guess means the first second of every call is
        judged against a number that has nothing to do with this line.
        """
        seeded = max(self.FLOOR_MIN, min(self.FLOOR_MAX, level_dbfs))
        self.noise_floor = seeded
        self._window.clear()
        self._window.append((seeded, 1.0))
        self._window_ms = 1.0
        self._speech_ms = 0.0
        self._silence_ms = 0.0

    def reset(self) -> None:
        """Forget the run of speech or silence, but keep the learned floor."""
        self.speaking = False
        self._speech_ms = 0.0
        self._silence_ms = 0.0


def pcm_from_wav(wav: bytes) -> bytes:
    """Pull the samples out of a complete WAV file.

    Finds the data chunk rather than assuming a 44 byte header, for the same
    reason the capture path does: encoders add metadata chunks and the header
    is routinely longer than the textbook says.
    """
    idx = wav.find(b"data", 12)
    if idx < 0 or len(wav) < idx + 8:
        return wav
    return wav[idx + 8:]


class Leveller:
    """Hold streamed speech at a steady loudness, chunk to chunk.

    Fish generates a streamed reply in pieces, and the pieces do not come out at
    the same level. Measured on a live sentence: speech chunks ranged over 8 dB,
    which is a doubling of loudness, and Hugo heard it as "goes from loud to
    sounding like she's inside a box... seems like it's changing voice". None of
    Fish's own controls fix it. normalize_loudness, condition_on_previous_chunks
    and a larger chunk_length all measured the same spread, because it is
    inherent to generating in chunks.

    So it is corrected here instead, where we own the audio.

    Two things this must NOT do. It must not touch silence, or the gaps between
    words get amplified into hiss. And it must not chase every chunk exactly, or
    quiet speech gets yanked up and loud speech shoved down within a single
    sentence, which sounds worse than the problem. Hence a floor and a slew
    limit: gain moves gradually and only on chunks that contain speech.
    """

    def __init__(self, target_dbfs: float = -17.0, floor_dbfs: float = -45.0,
                 max_step_db: float = 2.0, max_gain_db: float = 12.0):
        self.target = target_dbfs
        self.floor = floor_dbfs
        self.max_step = max_step_db
        self.max_gain = max_gain_db
        self._gain_db = 0.0

    def apply(self, pcm: bytes) -> bytes:
        level = rms_dbfs(pcm)
        if level > self.floor:                    # speech, not a gap
            wanted = self.target - level
            wanted = max(-self.max_gain, min(self.max_gain, wanted))
            step = max(-self.max_step, min(self.max_step, wanted - self._gain_db))
            self._gain_db += step
        if abs(self._gain_db) < 0.1:
            return pcm
        factor = 10 ** (self._gain_db / 20.0)
        samples = array.array("h")
        samples.frombytes(pcm[: len(pcm) - (len(pcm) % 2)])
        out = array.array("h")
        for s in samples:
            v = int(s * factor)
            out.append(32767 if v > 32767 else -32768 if v < -32768 else v)
        return out.tobytes()


def trim_tail(pcm: bytes, silence_ms: float, keep_ms: float = 200.0) -> bytes:
    """Cut the end-of-turn silence off a buffer before sending it to the STT.

    A little is kept so the last word is not clipped. Uploading the full pad
    makes the STT more likely to invent filler out of the quiet part.
    """
    drop_ms = silence_ms - keep_ms
    if drop_ms <= 0:
        return pcm
    n = int(drop_ms / 1000.0 * config.AI_RATE) * config.SAMPLE_WIDTH
    return pcm[:-n] if 0 < n < len(pcm) else pcm


def wav_bytes(pcm: bytes, rate: int = config.AI_RATE) -> bytes:
    """Wrap raw mono 16-bit PCM in a WAV container, for APIs that want a file."""
    import struct

    data_len = len(pcm)
    return (
        b"RIFF"
        + struct.pack("<I", 36 + data_len)
        + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
        + b"data"
        + struct.pack("<I", data_len)
        + pcm
    )

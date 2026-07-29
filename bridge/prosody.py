"""Hearing when somebody has FINISHED, rather than waiting to be sure.

The problem this solves. Silence does not mean a person has finished talking.
Somebody thinking mid-sentence goes quiet for exactly as long as somebody who
has come to the end, so a detector built only on silence has to pick a number
and live with it. Ours picked 1.1 seconds, and every reply on every call paid
that, on top of everything else.

A human does not wait 1.1 seconds. They hear the sentence LAND. English marks
the end of an utterance in the voice itself, before the silence arrives:

  a statement falls        pitch drops through the last stressed syllable
  a question rises         pitch climbs sharply on the last syllable or two
  a thinking pause does neither, it holds level, often mid-phrase, and the
                           energy stays up because the speaker intends to carry on

So this watches pitch and loudness on the far end and reports which of those
three just happened. When it says "that landed", the agent can answer after a
short pause instead of the full patient one. When it says "they are still
going", the full wait stands, which is the case that was always worth waiting
for.

WHY THIS IS HARDER ON A PHONE THAN IT LOOKS

  8 kHz. Fine for pitch, as it happens. A human voice sits between about 60 and
  400 Hz and the line carries up to 4 kHz, so the fundamental is comfortably
  present. It is the higher formants that a phone throws away, and we do not
  need them.

  mu-law. Companding is lossy in a way that adds quantisation noise to quiet
  samples, which is exactly where a naive pitch tracker goes wrong. Handled by
  refusing to track pitch at all below an energy floor, and by requiring a
  genuinely periodic autocorrelation peak rather than just the largest one.

  Halving and doubling. Autocorrelation happily locks onto twice or half the
  real period. Guarded by preferring the shortest lag whose peak is close to the
  best, which is the standard fix and costs nothing.

Nothing here decides anything on its own. It shortens a wait when it is
confident and stays out of the way otherwise, so the worst case is the
behaviour we already had.
"""
from __future__ import annotations

import math
import time

from . import ulaw

RATE = 8000
# 20ms of audio. Long enough to hold two periods of the lowest voice we track,
# short enough that a contour is several frames rather than one.
FRAME = 160
# A human fundamental. 60 Hz is a very low male voice, 400 Hz a raised female
# one. Wider than this and the tracker starts finding periodicity in noise.
F0_MIN, F0_MAX = 60.0, 400.0
LAG_MIN = int(RATE / F0_MAX)          # 20 samples
LAG_MAX = int(RATE / F0_MIN)          # 133 samples
# Below this a frame is silence or line noise, and its pitch is meaningless.
VOICED_DBFS = -45.0
# How periodic the autocorrelation peak must be to count as a voiced frame.
# Below this it is noise with a favourite lag, not a vocal cord.
VOICED_R = 0.35
# The contour is read over the tail of the utterance, which is where English
# puts the information. Long enough to hold a couple of syllables.
TAIL_MS = 420
# Semitones per second. Speech pitch wanders by a few semitones constantly, so
# a terminal fall has to be clearly bigger than that wander to count.
FALL_ST_PER_S = -2.2
RISE_ST_PER_S = 3.0
# How far the loudness has dropped across the tail, in dB. A speaker running out
# of a sentence gets quieter; one pausing to think does not.
DECAY_DB = 4.0
# Nothing is decided on fewer voiced frames than this, because a slope through
# three points is a guess.
MIN_VOICED = 6
# A reading older than this is about a different sentence.
STALE_S = 2.0
# Beyond this, the reading is not speech, it is the tracker having jumped an
# octave. Real speech moves a handful of semitones a second; a live call
# produced "+70.1 st/s" and, because any rise over 3.0 counted as a question,
# she answered early on pure nonsense and then got cut off mid-word for it.
# Anything past this is refused outright rather than believed.
# Tightened 25 -> 18 after a live call logged "+24.2 st/s" and squeaked under
# the old ceiling. Conversational English rarely moves more than about 15
# semitones a second even on a sharp question, so anything nearer 25 is far
# more likely to be the tracker than the talker.
MAX_ST_PER_S = 18.0
# How much of the tail may be octave jumps before the whole reading is thrown
# away. One bad frame in a contour is survivable; a third of them is not.
MAX_JUMP_RATIO = 0.25


def _f0(samples, mean: float) -> tuple[float, float]:
    """Pitch of one frame by autocorrelation. Returns (hz, periodicity 0 to 1).

    Zero hz means unvoiced, which is a perfectly normal answer: roughly half the
    frames in running speech are consonants or breath and have no pitch at all.
    """
    import numpy as np

    x = samples - mean
    energy = float(np.dot(x, x))
    if energy <= 0.0:
        return 0.0, 0.0

    # Correlate the frame against itself at every plausible period.
    n = len(x)
    lags = range(LAG_MIN, min(LAG_MAX, n - 1) + 1)
    best_lag, best_r = 0, 0.0
    scores = {}
    for lag in lags:
        a, b = x[: n - lag], x[lag:]
        denom = math.sqrt(float(np.dot(a, a)) * float(np.dot(b, b)))
        if denom <= 0.0:
            continue
        r = float(np.dot(a, b)) / denom
        scores[lag] = r
        if r > best_r:
            best_r, best_lag = r, lag

    if best_lag == 0 or best_r < VOICED_R:
        return 0.0, best_r

    # Octave guard. Autocorrelation is just as happy at twice the true period,
    # which reads as the voice suddenly dropping an octave and ruins the slope.
    # Prefer the SHORTEST lag that is nearly as periodic as the winner.
    for lag in sorted(scores):
        if lag < best_lag and scores[lag] >= best_r * 0.92:
            best_lag = lag
            break
    return RATE / float(best_lag), best_r


def _semitones(hz: float, ref: float) -> float:
    return 12.0 * math.log2(hz / ref) if hz > 0 and ref > 0 else 0.0


def _slope(points: list[tuple[float, float]]) -> float:
    """Least squares gradient of (seconds, value). Zero if it cannot be fitted."""
    n = len(points)
    if n < 3:
        return 0.0
    mx = sum(p[0] for p in points) / n
    my = sum(p[1] for p in points) / n
    num = sum((p[0] - mx) * (p[1] - my) for p in points)
    den = sum((p[0] - mx) ** 2 for p in points)
    return num / den if den else 0.0


class Prosody:
    """Listens to the far end and says whether their last sentence landed.

    Fed the same raw mu-law that goes to the transcriber, so it costs no extra
    audio path and cannot disagree with what was heard.
    """

    def __init__(self) -> None:
        self._buf = bytearray()
        # (audio seconds, hz, dbfs) per frame, voiced frames only.
        self._frames: list[tuple[float, float, float]] = []
        self._last_voiced_at = 0.0        # audio clock, for the contour
        self._last_voiced_wall = 0.0      # wall clock, for staleness only
        # Seconds of audio seen. This, NOT time.monotonic(), is the time base
        # for every slope. Wall clock looks right on a live call because frames
        # arrive in real time, and is catastrophically wrong the moment they do
        # not: a jitter buffer catching up delivers 200ms of audio in 5ms, the
        # timestamps collapse together, and the fitted slope explodes to
        # hundreds of semitones a second. Measured, on exactly that: -1757 st/s
        # for a contour that really falls at about 12.
        self._clock = 0.0

    def feed(self, ulaw_bytes: bytes) -> None:
        """Take far-end audio. Safe to call from the socket thread."""
        import numpy as np

        self._buf.extend(ulaw_bytes)
        while len(self._buf) >= FRAME:
            chunk = bytes(self._buf[:FRAME])
            del self._buf[:FRAME]
            pcm = np.frombuffer(ulaw.decode(chunk), dtype="<i2").astype(np.float64)
            if pcm.size < FRAME:
                continue
            mean = float(pcm.mean())
            rms = math.sqrt(float(np.dot(pcm - mean, pcm - mean)) / pcm.size)
            dbfs = 20.0 * math.log10(rms / 32768.0) if rms > 0 else -120.0
            now = self._clock
            self._clock += FRAME / RATE
            if dbfs < VOICED_DBFS:
                continue                      # silence, and silence has no pitch
            hz, _r = _f0(pcm, mean)
            if hz <= 0.0:
                continue                      # a consonant, which is not a mistake
            self._frames.append((now, hz, dbfs))
            self._last_voiced_at = now
            self._last_voiced_wall = time.monotonic()
            # Two seconds of contour is plenty and keeps this bounded.
            cutoff = now - STALE_S
            if len(self._frames) > 400:
                self._frames = [f for f in self._frames if f[0] >= cutoff]

    def verdict(self) -> tuple[str, str]:
        """What the last stretch of speech did. One of:

            "fell"    a statement landed. They are finished.
            "rose"    a question landed. They are finished, and waiting on you.
            "held"    level pitch, energy still up. Mid-thought, let them carry on.
            "unsure"  not enough voiced audio to say. Behave as before.

        The second value is a short reason, for the call log, because a turn
        taken early on a wrong reading is exactly the thing somebody will need
        to explain later.
        """
        if not self._frames or time.monotonic() - self._last_voiced_wall > STALE_S:
            return "unsure", "no recent voiced speech"

        tail = [f for f in self._frames if f[0] >= self._last_voiced_at - TAIL_MS / 1000.0]
        if len(tail) < MIN_VOICED:
            return "unsure", f"only {len(tail)} voiced frames in the tail"

        # Throw out frames that jumped an octave from their neighbour. That is
        # the classic autocorrelation failure and it is what produced the
        # +70 st/s reading; a real voice does not double in pitch in 20ms.
        clean = [tail[0]]
        jumps = 0
        for f in tail[1:]:
            if abs(_semitones(f[1], clean[-1][1])) > 7.0:
                jumps += 1
                continue
            clean.append(f)
        if jumps > len(tail) * MAX_JUMP_RATIO:
            return "unsure", f"{jumps} octave jumps in {len(tail)} frames, unreliable"
        if len(clean) < MIN_VOICED:
            return "unsure", f"only {len(clean)} clean frames after removing jumps"
        tail = clean

        t0 = tail[0][0]
        ref = tail[0][1]
        pitch = [(f[0] - t0, _semitones(f[1], ref)) for f in tail]
        st_per_s = _slope(pitch)
        # A slope this steep is a tracking artefact, not an intonation contour.
        if abs(st_per_s) > MAX_ST_PER_S:
            return "unsure", f"pitch {st_per_s:+.0f} st/s is not a real contour"

        # Loudness across the tail, first quarter against last quarter, which is
        # steadier than a slope through a noisy envelope.
        q = max(1, len(tail) // 4)
        head_db = sum(f[2] for f in tail[:q]) / q
        end_db = sum(f[2] for f in tail[-q:]) / q
        decay = head_db - end_db

        if st_per_s <= FALL_ST_PER_S and decay >= DECAY_DB:
            return "fell", f"pitch {st_per_s:+.1f} st/s, quieter by {decay:.1f} dB"
        if st_per_s >= RISE_ST_PER_S:
            return "rose", f"pitch {st_per_s:+.1f} st/s"
        # A fall on its own, without the speaker also tailing off, is the shape
        # of somebody drawing breath in the middle of a thought.
        if st_per_s <= FALL_ST_PER_S:
            return "held", f"pitch fell {st_per_s:+.1f} st/s but stayed loud"
        return "held", f"pitch {st_per_s:+.1f} st/s, level"

    def finished(self) -> tuple[bool, str]:
        """Did their last sentence land? The question the agent actually asks."""
        verdict, why = self.verdict()
        return verdict in ("fell", "rose"), f"{verdict}: {why}"

    def reset(self) -> None:
        """Forget the contour. Called once we have answered, so the next turn is
        judged on its own audio and not on the tail of the previous one."""
        self._frames.clear()
        self._last_voiced_at = 0.0
        self._last_voiced_wall = 0.0

"""Configuration and credential loading for the AI calling bridge.

Keys are read from the environment first, then from known local files, so the
bridge runs without anything being pasted into a shell.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Where to go looking for a key if it is not already in the environment.
# Order matters: first hit wins.
KEY_FILES = [
    REPO / ".env",
    REPO / ".vercel" / ".env.production.local",
    Path.home() / "Whats" / "Lemlin" / ".env.local",
]


def _from_files(name: str) -> str | None:
    pattern = re.compile(rf"^{re.escape(name)}\s*=\s*(.+)$")
    for path in KEY_FILES:
        try:
            for line in path.read_text(errors="ignore").splitlines():
                m = pattern.match(line.strip())
                if m:
                    return m.group(1).strip().strip('"').strip("'")
        except OSError:
            continue
    return None


def key(name: str, default: str | None = None, required: bool = False) -> str | None:
    value = os.environ.get(name) or _from_files(name) or default
    if required and not value:
        raise RuntimeError(
            f"{name} is not set. Put it in the environment or in one of: "
            + ", ".join(str(p) for p in KEY_FILES)
        )
    return value


# --- Audio -----------------------------------------------------------------
# scrcpy hands us 48 kHz stereo 16-bit. The AI side wants 16 kHz mono, which is
# an exact 3:1 decimation, so no resampling library is needed.
DEVICE_RATE = 48000
DEVICE_CHANNELS = 2
AI_RATE = 16000
SAMPLE_WIDTH = 2
# The WAV header is NOT 44 bytes. scrcpy sets a comment tag and does not set
# AVFMT_FLAG_BITEXACT, so libavformat writes a LIST/INFO chunk too and the real
# header runs to about 110. The header is located by finding the "data" chunk
# rather than assuming a length; this is only the sanity cap on that search.
MAX_WAV_HEADER_BYTES = 4096

# --- Turn taking -----------------------------------------------------------
# Silence long enough to count as "they stopped talking". Shorter feels snappy
# but cuts people off mid-sentence; longer feels sluggish.
END_OF_TURN_SILENCE_MS = 700
# Speech shorter than this is a cough, a click or line noise, not a turn.
# Measured against SPEECH inside the buffer, never the buffer's own length: the
# buffer always ends with the silence that closed the turn, so a length test can
# never fail and one 21ms click would upload 700ms of near-silence, which the
# STT reliably hallucinates into a phrase ("Thank you.") that the agent answers.
MIN_UTTERANCE_MS = 350
# Nothing may hold a turn open forever, whatever the VAD believes. This is the
# backstop that turns a VAD bug into a clipped sentence instead of a silent
# seven minute call.
MAX_UTTERANCE_MS = 20000
# No audio at all for this long means the line is gone. Checked whether or not
# we heard speech first: gating it on "we have not heard anyone yet" left a
# dropped call spinning until the hard cap.
DEAD_LINE_S = 5.0
# The prospect talking over the AI for this long counts as an interruption.
# Raised from 300ms after the first live call: the far end's handset echoes our
# own TTS back down the line, and 300ms of that looked exactly like a person
# interrupting. A real interruption is sustained; an echo blip is not.
BARGE_IN_MS = 900
# How far above the noise floor sound must be, while we are speaking, to count
# as the prospect rather than our own echo returning.
BARGE_IN_MARGIN_DB = 26.0
# Ignore everything for this long after starting to speak. The echo of our own
# first syllable arrives inside this window.
BARGE_IN_GRACE_MS = 1200
# Set BRIDGE_NO_BARGE=1 to disable interruption entirely, which is the way to
# isolate whether a problem is echo or something else.
BARGE_IN_ENABLED = os.environ.get("BRIDGE_NO_BARGE", "") != "1"
# After we stop speaking, let the tail of our own echo pass before we start
# listening, or the agent transcribes itself and replies to its own words.
ECHO_SETTLE_MS = 400

# Give up on a call that produces no audio at all.
NO_AUDIO_TIMEOUT_S = 45
# Anything above this is real audio rather than digital silence. Ringback is not
# captured on the downlink, so the first real audio IS the answer.
ANSWER_GATE_DBFS = -70.0
# How many consecutive chunks must clear that gate. One is not enough: rms is a
# mean over the chunk, so a single sample at half a percent of full scale trips
# it, and a false answer plays the opener into a phone that is still ringing.
ANSWER_ONSET_CHUNKS = 3
# Hard cap so a stuck call cannot run up a bill.
MAX_CALL_SECONDS = 420

# --- Models ----------------------------------------------------------------
LLM_MODEL = os.environ.get("BRIDGE_LLM_MODEL", "claude-haiku-4-5-20251001")
# Reasoning must stay OFF. Measured time-to-first-token with reasoning enabled
# runs to tens of seconds, which is unusable on a live call.
LLM_MAX_TOKENS = 150

# Measured on a 2.7s utterance, best of 2, warm:
#   gpt-4o-mini-transcribe  637 ms   <- chosen
#   gpt-4o-transcribe       701 ms
#   whisper-1               893 ms
# All three returned identical text. Cold start on any of them is ~1.8s, so the
# first call of a session is slower than the rest.
WHISPER_MODEL = os.environ.get("BRIDGE_STT_MODEL", "gpt-4o-mini-transcribe")

ELEVENLABS_VOICE = os.environ.get("BRIDGE_VOICE_ID", "o6wnoeR1UlXDVucYjZmq")
ELEVENLABS_MODEL = "eleven_flash_v2_5"

# --- Device ----------------------------------------------------------------
ADB_SERIAL = os.environ.get("BRIDGE_ADB_SERIAL")  # None = first device found
# The handset's own automatic gain control amplifies a quiet input and clips it,
# so a lower playback level reaches the far end cleaner than a loud one.
# Measured on a Galaxy A16: 100% clipped at 0.0 dB, 65% was clean.
SPEAKER_VOLUME = int(os.environ.get("BRIDGE_SPEAKER_VOLUME", "65"))

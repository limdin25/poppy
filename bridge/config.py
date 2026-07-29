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
# Dropped from 700ms. Every millisecond here is dead air before the agent even
# starts thinking, and dead air is what makes a call feel robotic. 500 still
# comfortably clears the natural pause inside a sentence.
# Cut again to 250: measured, this wait plus transcription is 878ms of the
# 1222ms a prospect experiences, all of it before the model even starts. The
# risk is real, a slow talker mid-pause gets cut off, so if that starts
# happening put it back up rather than living with it.
END_OF_TURN_SILENCE_MS = 250

# The noises a person makes while thinking. Taken from the Retell agent Hugo
# already rates ("Yeah", "Right", "Okay", "Gotcha", "Exactly", "No worries",
# "Mm") at its own frequency of 0.45. One is played the instant the prospect
# stops talking, while the model is still writing, so the gap is filled with
# something human instead of silence. Costs no time: it overlaps the thinking.
BACKCHANNEL_WORDS = ("Mm.", "Right.", "Yeah.", "Okay.", "Gotcha.", "Sure.", "Mm hmm.")
BACKCHANNEL_CHANCE = 0.45
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
# When interrupted, finish the word in flight before going quiet. Cutting at the
# instant of the decision chops a syllable in half and sounds broken; a person
# finishes the word and then stops. About one word at conversational pace.
FINISH_WORD_MS = 200

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

# --- AssemblyAI streaming speech-to-text ------------------------------------
# Replaces batch Whisper. Measured cost of the old path: 250ms waiting for
# silence plus 478ms uploading and transcribing, all of it AFTER they stopped
# talking. This transcribes continuously and reports end-of-turn itself.
AAI_STREAMING = os.environ.get("BRIDGE_AAI_STREAMING", "1") != "0"
# min_latency / balanced / max_accuracy. Latency is the complaint, so start
# there; move to "balanced" if regional accents start coming back wrong.
AAI_MODE = os.environ.get("BRIDGE_AAI_MODE", "min_latency")
# Their telephony guidance: on 8 kHz mu-law, ask it to admit when audio is
# genuinely unintelligible rather than inventing a plausible word. A wrong guess
# reaches Claude as fact and gets answered as if the prospect had said it.
AAI_PROMPT = os.environ.get(
    "BRIDGE_AAI_PROMPT",
    "A UK phone call with a tradesperson about Google reviews. "
    "Tag genuinely unclear speech as [unclear] rather than guessing.",
)
# How long to wait for a finished turn before treating the line as quiet.
AAI_TURN_TIMEOUT_S = 12.0

ELEVENLABS_VOICE = os.environ.get("BRIDGE_VOICE_ID", "o6wnoeR1UlXDVucYjZmq")
# flash_v2_5 is the FASTEST ElevenLabs model, not the most natural. It buys its
# latency by flattening prosody, which is exactly the "robotic tonality" Hugo
# heard. turbo_v2_5 costs roughly 150ms more and carries far more intonation.
# The real fix is Cartesia sonic-3.5, which is literally what Retell uses.
ELEVENLABS_MODEL = os.environ.get("BRIDGE_TTS_MODEL", "eleven_turbo_v2_5")
# Delivery, tuned to match the Retell agent Hugo already likes the sound of
# (cartesia-Emma, sonic-3.5, speed 0.98, temperature 1.1). Low stability is the
# important one: high stability reads flat and even, which is exactly what makes
# a voice sound like it is reading rather than talking.
VOICE_STABILITY = float(os.environ.get("BRIDGE_VOICE_STABILITY", "0.40"))
VOICE_SIMILARITY = float(os.environ.get("BRIDGE_VOICE_SIMILARITY", "0.75"))
VOICE_STYLE = float(os.environ.get("BRIDGE_VOICE_STYLE", "0.35"))
VOICE_SPEED = float(os.environ.get("BRIDGE_VOICE_SPEED", "0.98"))

# Cartesia: what the Retell agent Hugo rates actually runs.
CARTESIA_MODEL = os.environ.get("BRIDGE_CARTESIA_MODEL", "sonic-3.5")
# Fish Audio. s2.1-pro-free is genuinely free until 2026-08-31, with no character
# cap and no card, which makes it the cheapest way to find out whether the voice
# is right. Two caveats that come with the free tier and matter later, not now:
# they give no uptime or latency guarantee on it ("built for experimentation"),
# and requests may be used to improve their model. Switch to "s2.1-pro" before
# running anything that depends on it staying up.
FISH_MODEL = os.environ.get("BRIDGE_FISH_MODEL", "s2.1-pro")
# The voice itself. NOT optional: with no reference_id Fish generates a brand new
# random voice on every request, so a call comes out as several different people.
# "british female", the most-liked generic British female in their library.
# "British" - female, middle-aged, tagged conversational, energetic, cheerful,
# friendly, expressive. Hugo picked it by ear, replacing an earlier one tagged
# narration and ASMR: those tags are baked into how a voice was trained, not a
# setting you can turn off, and it read as dawdling on a call.
# 1.3 measured 16.4 characters a second, top of the natural range, and Hugo
# heard it as rushed. 1.1 sits nearer 14, which reads as unhurried. Pace is
# not only speed though: the pauses come from [break] cues in the script, and
# a voice that never pauses sounds hurried at any speed.
FISH_VOICE = os.environ.get("BRIDGE_FISH_VOICE", "a4c68282850b4568bc92749fa2c16815")
FISH_SPEED = float(os.environ.get("BRIDGE_FISH_SPEED", "1.1"))
# Measured: the library voices land around -23 dBFS, a phone line wants ~-17.
FISH_VOLUME = float(os.environ.get("BRIDGE_FISH_VOLUME", "6"))
# 100 is their floor and starts sooner; 300 is the default and starts later.
FISH_CHUNK = int(os.environ.get("BRIDGE_FISH_CHUNK", "120"))
# Their defaults. Higher temperature is more expressive and less predictable.
FISH_TEMPERATURE = float(os.environ.get("BRIDGE_FISH_TEMPERATURE", "0.7"))
FISH_TOP_P = float(os.environ.get("BRIDGE_FISH_TOP_P", "0.7"))
# Stream over a websocket held open for the call. Measured on the FREE model:
# ~510ms to open (paid once, during the ring) then 271-278ms to first audio on
# every reply, against 477ms and up to 1150ms for the plain HTTP call.
FISH_STREAMING = os.environ.get("BRIDGE_FISH_STREAMING", "1") != "0"
# How long to wait for the FIRST chunk of a reply before giving up on it.
FISH_FIRST_AUDIO_S = 8.0
# Fish sends no per-flush terminator, so a quiet gap after audio has started is
# how an utterance ends. Erring long only delays the handover to listening;
# erring short clips the end of her sentence, which is far worse.
FISH_QUIET_TAIL_S = 0.9
# Google Chirp 3: HD, en-GB. 1M characters a month free, then $30/M.
GOOGLE_VOICE = os.environ.get("BRIDGE_GOOGLE_VOICE", "en-GB-Chirp3-HD-Achernar")

# --- Telnyx ----------------------------------------------------------------
# How long to let it ring. Ofcom requires at least 15 seconds before abandoning
# an unanswered call, so this floor is a rule, not a preference.
TELNYX_RING_SECONDS = 30
# How long to wait for the media websocket AFTER the call is answered. Telnyx
# opens it on answer, not on dial, so this is only ever a few seconds. It is
# deliberately NOT the ring timeout: conflating the two turned "they were slow
# to pick up" into a fake websocket error on a live call.
TELNYX_ATTACH_TIMEOUT_S = 15.0

# --- Device ----------------------------------------------------------------
ADB_SERIAL = os.environ.get("BRIDGE_ADB_SERIAL")  # None = first device found
# The handset's own automatic gain control amplifies a quiet input and clips it,
# so a lower playback level reaches the far end cleaner than a loud one.
# Measured on a Galaxy A16: 100% clipped at 0.0 dB, 65% was clean.
SPEAKER_VOLUME = int(os.environ.get("BRIDGE_SPEAKER_VOLUME", "65"))

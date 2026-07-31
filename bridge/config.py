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

# Simulated disfluency. A voice that glides through every sentence is one of
# the tells; a person trips on the start of a thought now and then. Injected in
# code (bridge/disfluency.py) rather than asked of the model, because a model
# told to stutter does it every other line, which is the broken-record failure.
# CHANCE is per reply; MIN_GAP is replies that must pass between trips, so it
# can never happen twice in a row; SLOW_S is the brain latency past which a
# trip at the start of the reply reads as genuine thinking rather than a tic.
# How much longer the settled-partial wait runs when the prosody reader says
# "held": level pitch, energy up, somebody mid-thought. Guessing the end of a
# sentence there is answering half of it. At 2x the normal wait the fast path
# is effectively deferred to AssemblyAI's own end-of-turn decision, which is
# the patient, right-rather-than-fast reading.
HELD_PATIENCE = float(os.environ.get("BRIDGE_HELD_PATIENCE", "2.0"))

# How many EMOTION cues one reply may carry to the voice. Mechanics ([break],
# [emphasis]) are exempt. Enforced in clean_cues; the prompt's "about one turn
# in two" guidance kept producing a feeling per sentence, which is the
# caricature, so the ceiling lives here.
CUE_BUDGET = int(os.environ.get("BRIDGE_CUE_BUDGET", "2"))

DISFLUENCY_ENABLED = os.environ.get("BRIDGE_DISFLUENCY", "1") != "0"
DISFLUENCY_CHANCE = float(os.environ.get("BRIDGE_DISFLUENCY_CHANCE", "0.16"))
DISFLUENCY_MIN_GAP = int(os.environ.get("BRIDGE_DISFLUENCY_MIN_GAP", "2"))
DISFLUENCY_SLOW_S = float(os.environ.get("BRIDGE_DISFLUENCY_SLOW_S", "2.0"))
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
# Raised from 200 after Hugo: "she cuts the word. Never cut the word. Cut the
# sentence, but not the word." The arithmetic says he is right: at 14 characters
# a second an average word plus its space is about six characters, so a whole
# word runs ~430ms and 200ms only ever finished a third of one. A cut lands at a
# random point in a word, so on average half a word remains, and 350ms covers
# nearly all of them.
# The cost is honest: she now overlaps the prospect by this much AFTER deciding
# to stop, on top of the time it took to decide. If she starts feeling like she
# ploughs on, lower the interruption threshold rather than this, because this is
# the setting that stops her sounding broken.
FINISH_WORD_MS = 350

BARGE_IN_ENABLED = os.environ.get("BRIDGE_NO_BARGE", "") != "1"
# After we stop speaking, let the tail of our own echo pass before we start
# listening, or the agent transcribes itself and replies to its own words.
ECHO_SETTLE_MS = 400
# How long after she stops speaking a short fragment may still be her own voice
# coming back off the prospect's handset. Draining our audio buffer does not
# help: the transcriber already has those bytes. See Agent._own_echo.
ECHO_WINDOW_S = float(os.environ.get("BRIDGE_ECHO_WINDOW_S", "1.2"))
# How alike a whole turn has to be to what she just said before it is treated as
# her own voice returning rather than the prospect. 0.72 catches a near verbatim
# echo through a transcriber that adds its own punctuation, and leaves room for
# somebody genuinely repeating a phrase back at her.
ECHO_SIMILARITY = float(os.environ.get("BRIDGE_ECHO_SIMILARITY", "0.72"))

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

# How many times she may try to get one stage's answer before moving on anyway.
# A gate with no escape is a worse bug than the jumping it fixes: asking the
# same question five times running is how a person gets hung up on.
STAGE_MAX_TRIES = int(os.environ.get("BRIDGE_STAGE_MAX_TRIES", "3"))

# Whether the code chases her when a turn goes by without her saying she is an
# AI. It used to be forced: chase_disclosure() appended an instruction naming
# the exact words, which OVERRODE the prompt and made her announce it unprompted
# on every call. Hugo, twice: "don't disclose AI until they ask."
#
# Off does NOT mean she denies it. The prompt still requires her to say yes
# immediately, plainly and cheerfully the moment anybody asks, in any wording.
# What is off is volunteering it.
#
# Turn it back on for any market that requires proactive disclosure. California
# SB-1001 requires it for bots used to sell, and other states are similar, so
# this is a per-campaign decision rather than a preference.
REQUIRE_DISCLOSURE = os.environ.get("BRIDGE_REQUIRE_DISCLOSURE", "") == "1"

# --- Models ----------------------------------------------------------------
# Re-measured on the REAL prompt with a real mid-call history, which is the only
# test that means anything. The earlier bench used a single cold turn and got
# the ranking right but the margins badly wrong.
#
#   model                TTFT     whole reply   what it wrote
#   claude-haiku-4-5     764ms      960ms       "Three reviews across how long?"
#   claude-sonnet-4-5    986ms     1595ms       two sentences, then a question
#   claude-sonnet-5     1805ms     2228ms       too slow
#   claude-fable-5      3095ms     4148ms       far too slow
#
# Haiku wins on both counts, and the second column is the one that matters:
# Fish only starts synthesising once it has chunk_length characters (floor 100)
# or a flush, and our replies are ~50 characters, so the buffer NEVER fills and
# every reply waits for the whole thing to be written. A model that answers in
# eight words is therefore faster than its time-to-first-token suggests, and a
# chatty one is slower. Sonnet was not "smarter", it was wordier, and wordier is
# the actual defect: it ignored the twelve-word rule on every turn.
LLM_MODEL = os.environ.get("BRIDGE_LLM_MODEL", "claude-haiku-4-5-20251001")
# Reasoning must stay OFF. Measured time-to-first-token with reasoning enabled
# runs to tens of seconds, which is unusable on a live call.
LLM_MAX_TOKENS = 150
# Hard ceiling on how much of a reply is ever spoken, enforced in code because
# the prompt asking for it plainly did not work. Past this many words the reply
# is cut at the next full stop, and a question always ends the turn wherever it
# lands. Hugo, twice: "she keep talking over and over and over me", "ask one
# question at a time and wait to get the answer".
# Cut from 28. The cap bites at the NEXT full stop past the limit, so 28 was
# letting 32 word features lists through: "I answer the phone, take messages,
# book jobs in, text people back. No missed calls, no holidays..." which is
# word for word the "Bad" example in her own prompt. 24 makes the cap land
# before the third clause.
# Raised 24 -> 34. The cap cuts at the next full stop PAST the limit, and her
# explanation plus its closing question runs about 30 words, so 24 was landing
# the cut on the full stop BEFORE the question and deleting it. On a live call
# she listed what she does, the "How does that sound?" was cut off, and the call
# died in silence with the prospect waiting for her to finish. That is both the
# "cutting halfway" and the "no reaction" Hugo reported, from one number.
# 34 was still letting 42 word turns through, because the cut lands at the next
# full stop PAST the limit and a list has no full stops in it. Lowered to 28,
# but the real fix is upstream: the stage briefs no longer ask her to read a
# list, because a cap can only ever chop a monologue, not prevent one.
MAX_SPOKEN_WORDS = int(os.environ.get("BRIDGE_MAX_WORDS", "28"))

# The upstream fix that comment asks for, finally in code. The prompt fix held
# for one call and then the list came straight back, so the clause count is
# enforced in bridge/copy_guard.py instead, which is the same move the long-dash
# rule and the cue allowlist both ended up making.
#
# Two clauses, then the sentence ends. "Takes the calls you'd otherwise miss,
# books jobs straight in" is a person talking; adding "texts people back,
# basically covers your line when you can't" is a brochure being read out.
#
# The word floor is what keeps the rule off ordinary speech: "Yeah, no worries,
# I'll be quick." and "Okay, got it, so what's your setup?" both carry two
# commas inside five words and both are fine. Measured against all 89 AI turns
# of the US campaign, 5 was the highest floor that still caught every list.
LIST_MAX_CLAUSES = int(os.environ.get("BRIDGE_LIST_MAX_CLAUSES", "2"))
LIST_MIN_WORDS = int(os.environ.get("BRIDGE_LIST_MIN_WORDS", "5"))

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
# But NOT after she has been cut off. Somebody who interrupts is usually about
# to say something, and when they do not, both sides end up waiting: she sits in
# the 12 second window and they sit waiting for her to carry on. Measured on a
# live call, that produced six seconds of dead air twice, and the second time
# the prospect had to say "What? Sorry?" to break it. The call then died as
# "went_quiet" with nobody having hung up.
# So after an interruption she waits only this long, and if nothing comes she
# picks up where she left off, which is what a person does.
RESUME_AFTER_CUT_S = float(os.environ.get("BRIDGE_RESUME_AFTER_CUT_S", "2.5"))
# What she is handed as their turn when that happens. It reaches the model as a
# user message and the prompt explains it, so the behaviour is visible in the
# transcript rather than being a silent special case.
WENT_QUIET = "(they said nothing)"
# When a turn ends on an obviously unfinished thought ("...twenty, but"), hold
# on this long for the rest before replying. Silence is not the same as having
# finished, and answering half a sentence is how an agent talks over the
# important half. Short enough that a genuine full stop is barely delayed.
UNFINISHED_WAIT_S = 1.6
# How long a partial transcript must stop changing before we treat the person as
# having finished. AssemblyAI is deliberately patient about declaring a turn
# over, around two seconds, because it would rather be right than quick. A
# partial that has not moved for this long already tells us they stopped, so
# acting on it is the single biggest latency win available. Too short and we
# interrupt a thinking pause; too long and we have gained nothing.
SETTLED_PARTIAL_S = 1.1
# A partial must also be a real utterance, not a fragment, before we answer it.
# Measured on a live call at 0.45s with no length floor: it fired on "Uh, who's"
# and replied to half a question, while the actual question ("Uh, who is this?")
# arrived seconds later. Short answers do not need this path anyway, because
# AssemblyAI declares those finished quickly on its own; the speculative route
# only earns its keep on longer sentences where the 2s wait actually hurts.
#
# Raised 0.7 -> 1.1 after a second live failure: it fired on "Um, I just say,
# hey, please leave" during a mid-sentence thinking pause, so the prospect got
# two near-identical questions. This is the real tension in the whole idea: a
# thinking pause and a finished sentence sound identical, and only time tells
# them apart. 1.1s still beats AssemblyAI's ~2s while being much harder to fool.
# If double-replies appear again, raise it rather than trying to be clever.
SETTLED_PARTIAL_MIN_WORDS = 4
# The wait above exists ONLY because silence cannot tell a finished sentence
# from a thinking pause. When the prosody reader can tell, this shorter pause is
# used instead. On a turn it cannot read, the full wait above stands, so the
# worst case is the behaviour we had before.
#
# Was 0.35s on its first live call and that call was a mess. Prosody hears the
# end of a SENTENCE, and a turn can hold two: "I have a problem." falls away
# exactly like a finished thought, so she answered it while the prospect was
# still saying "there's something leaking". She then got barged out mid-word
# and the whole call turned into three-word fragments. 0.6 still saves half a
# second on the old wait while leaving room for a second sentence to start.
SETTLED_PARTIAL_FAST_S = float(os.environ.get("BRIDGE_SETTLED_FAST_S", "0.6"))
# Set BRIDGE_PROSODY=0 to turn the whole thing off and go back to silence alone,
# which is the way to tell a prosody misread from any other problem.
PROSODY_ENABLED = os.environ.get("BRIDGE_PROSODY", "") != "0"
# How long to let the person who answered say "hello" before speaking. Talking
# over their greeting is the most obviously machine thing a caller can do, and it
# also guarantees the opener is half-heard and has to be repeated. Long enough
# for a real greeting, short enough that a silent pickup is not awkward.
WAIT_FOR_HELLO_S = 2.5
# The ceiling on that wait, used only once they have actually STARTED talking.
#
# 2.5s is the right amount of silence to tolerate before opening into a dead
# line. It is nowhere near enough to hear out "Stroh Bros Plumbing, Dave
# speaking": that takes about three seconds to say, and AssemblyAI needs
# another second on top before it will call the turn finished. So the plain
# 2.5s wait expired mid-greeting and she talked straight over them, which is
# both rude and the reason the warm opener never got chosen.
#
# So: wait 2.5s for them to start. If they never do, open. If they DO, hold on
# until they finish, up to this. Silence is never punished, and nobody gets
# talked over.
WAIT_FOR_HELLO_MAX_S = float(os.environ.get("BRIDGE_WAIT_FOR_HELLO_MAX_S", "6.0"))

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
# Back to natural pace. 1.1 was chosen to stop her dawdling, but speed is
# compression, and prosody lives in the timing that gets compressed. Measured
# below: at 1.1 an [excited] and a [calm] render of the same sentence differed
# by 0.10 to 0.38 seconds; at 1.0 they differed by 0.70 to 0.92.
FISH_SPEED = float(os.environ.get("BRIDGE_FISH_SPEED", "1.0"))
# Measured: the library voices land around -23 dBFS, a phone line wants ~-17.
FISH_VOLUME = float(os.environ.get("BRIDGE_FISH_VOLUME", "6"))
# 100 is their floor and starts sooner; 300 is the default and starts later.
FISH_CHUNK = int(os.environ.get("BRIDGE_FISH_CHUNK", "120"))
# low / balanced / normal. Fish describe this as a quality trade-off, so it was
# an obvious suspect for her sounding flat. Measured across all three at two
# temperatures, the dynamic range came out 9.28 to 10.50 dB with no consistent
# winner, well inside the run-to-run noise. So "low" costs nothing measurable
# and keeps the speed. Left adjustable because it is cheap to retest by ear.
FISH_LATENCY = os.environ.get("BRIDGE_FISH_LATENCY", "low")
# NOT their defaults any more, and this was the miss. Both of these sat on 0.7
# for the whole build while the standing complaint was that she sounds flat.
# They are the two settings that decide how much variation the model is allowed,
# so leaving them at the default quietly suppressed every emotion cue in the
# prompt.
#
# Measured by rendering one line three ways, neutral, [excited] and [calm], and
# taking the duration difference between the two cued versions. If a cue is
# landing at all, those two readings cannot be the same length:
#
#   temp  top_p  speed   difference between [excited] and [calm]
#   0.7   0.7    1.1     0.04s to 0.18s     the cue is doing essentially nothing
#   0.9   0.7    1.1     0.38s
#   0.9   0.9    1.0     0.70s
#   1.0   1.0    1.0     0.92s
#
# 1.0 was shipped and Hugo's verdict was "she no longer sounds natural". Maximum
# temperature bought range at the cost of steadiness, which the first test never
# looked at. Rendering ONE line five times and measuring how much its length
# varies says it plainly:
#
#   temp  top_p  speed   wobble   cue spread
#   1.0   1.0    1.0     0.37s    0.84s      range, but it will not sit still
#   0.9   0.9    1.0     0.04s    0.79s      <- chosen. 94% of the range, 1/9th
#                                               of the wobble
#   0.7   0.7    1.1     0.07s    0.04s      steady and completely flat
#
# So 0.9 is not a compromise, it is strictly better than 1.0 here. Do not go
# back to 0.7: that is where the emotion cues stop doing anything at all.
# Lowered 0.9 -> 0.7 on 2026-07-31, and CEILINGED. The saved settings row had
# pushed these to 0.95, which is the sampling regime where S2.1 invents random
# noises and slips into other languages mid-sentence, both heard by Hugo on
# live calls. Fish's own stable default is 0.7. The character of the voice
# lives in the reference, the cues and the prosody settings, not up here in
# the sampling tail, so this trims the glitches without touching the vibe.
# The MAX values are enforced in settings.apply(), so a hot value saved on
# the settings page is clamped on its way onto a call rather than trusted.
FISH_TEMPERATURE = float(os.environ.get("BRIDGE_FISH_TEMPERATURE", "0.7"))
FISH_TOP_P = float(os.environ.get("BRIDGE_FISH_TOP_P", "0.7"))
FISH_TEMPERATURE_MAX = float(os.environ.get("BRIDGE_FISH_TEMPERATURE_MAX", "0.8"))
FISH_TOP_P_MAX = float(os.environ.get("BRIDGE_FISH_TOP_P_MAX", "0.9"))

# --- Emotion cues: block the NOISES, allow the feelings ---------------------
# Hugo: "she has access to all emotions she wants to use, that might be
# something better". He is right, and Fish's own documentation draws the line
# for us. It separates EMOTIONS, which change how a line is delivered, from
# AUDIO EFFECTS, which produce an actual sound. Only the second kind was ever
# the problem.
#
# Measured, mean of three renders of one line: warm 2.93s, curious 3.10s,
# amused 3.16s, all within noise of the bare 3.10s. [chuckling] came out at
# 4.13s, which is 0.93s of her actually laughing.
#
# So the code blocks the noises and nothing else, and the prompt handles taste.
# The old list of eleven was cutting her off from 38 documented feelings for no
# reason: cut back to five she came back "zero emotion, no charisma", and the
# fix for that is more palette, not less.
NOISES = {
    # Fish's "Audio Effects" table, every one of which makes a sound.
    "laughing", "chuckling", "sobbing", "crying loudly", "sighing", "groaning",
    "panting", "gasping", "yawning", "snoring", "clear throat",
    # And the crowd effects, which put a room full of people on the line.
    "audience laughing", "background laughter", "crowd laughing",
    # Wordings the model reaches for that mean the same thing.
    "laughs", "laugh", "chuckles", "chuckle", "giggles", "giggling", "sighs",
    "sigh", "gasp", "gasps", "cough", "coughs", "coughing", "sniffs",
    "lip-smacking", "breath", "inhale", "exhale", "ha ha", "haha",
}
# Every emotion Fish document, basic and advanced, plus the free-form ones
# measured safe here. All delivery only.
SAFE_CUES = {
    # Basic, 24
    "happy", "sad", "angry", "excited", "calm", "nervous", "confident",
    "surprised", "satisfied", "delighted", "scared", "worried", "upset",
    "frustrated", "depressed", "empathetic", "embarrassed", "disgusted",
    "moved", "proud", "relaxed", "grateful", "curious", "sarcastic",
    # Advanced, 25
    "disdainful", "unhappy", "anxious", "hysterical", "indifferent",
    "uncertain", "doubtful", "confused", "disappointed", "regretful", "guilty",
    "ashamed", "jealous", "envious", "hopeful", "optimistic", "pessimistic",
    "nostalgic", "lonely", "bored", "contemptuous", "sympathetic",
    "compassionate", "determined", "resigned",
    # Free-form, measured safe on our own voice
    "warm", "playful", "sincere", "amused", "friendly", "reassuring",
    # Tone markers that suit a phone call. Deliberately NOT shouting,
    # screaming or whispering: the first two are wrong for a sales call and the
    # third is unusable on an 8 kHz line.
    "emphasis", "soft tone",
    # Timing, which is not an emotion but is the one cue measured to change the
    # length of a line in the way we want: +0.74s of real pause.
    "break", "long-break",
}
CUES_ENABLED = os.environ.get("BRIDGE_CUES", "") != "0"
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
# Barge-in over a VoIP leg, which is a completely different problem to barge-in
# over a phone held next to a laptop speaker. Telnyx sends us only the far end,
# so there is no path for our own voice to come back and be mistaken for the
# prospect, and the thresholds can be far tighter than the SIM rig's.
# These live here, not as literals in telnyx.py, so the agent page can move them.
# 350 was too twitchy. A prospect saying "okay" or "mm" WHILE she talks is
# agreeing, not interrupting, and stopping dead for it left her three words into
# an introduction with nothing to show for it. Measured on a live call: two
# stops inside ninety seconds, both on a single word of agreement, both leaving
# a fragment. A real interruption is sustained; agreement is one short word.
# 550ms is about a word and a half, which agreement rarely reaches.
# 550 was still too quick to give way: Hugo, "she's too sensitive". Raised to
# 700, which is about two words. Below that she is reacting to agreement and
# throat-clearing rather than to somebody actually taking the floor, and being
# stopped three words into a sentence is worse than half a second of overlap.
TELNYX_BARGE_MS = float(os.environ.get("BRIDGE_TELNYX_BARGE_MS", "700"))
TELNYX_BARGE_GRACE_MS = float(os.environ.get("BRIDGE_TELNYX_BARGE_GRACE_MS", "250"))
# The race. When both sides start talking in the same breath, the human wins,
# and quickly. For the first stretch of her turn the interrupt threshold drops,
# so a prospect who was already mid-sentence when she opened her mouth stops
# her in about 350ms instead of demanding the full 700ms of proof. Past the
# window the normal threshold is back and a cough cannot stop her. Hugo,
# 2026-07-30: "she speaks over me". The grace window above still runs first,
# so her own first-syllable echo cannot ride the lowered bar.
BARGE_EARLY_WINDOW_MS = float(os.environ.get("BRIDGE_BARGE_EARLY_WINDOW_MS", "1200"))
BARGE_EARLY_FACTOR = float(os.environ.get("BRIDGE_BARGE_EARLY_FACTOR", "0.5"))
# Raised from 14, which was chosen on the belief that our own voice could not
# come back on a VoIP leg. A live call disproved that outright: her sentence
# returned as a transcribed turn, so it was plainly loud enough to trip a 14 dB
# interrupt as well. Echo is attenuated compared with somebody actually
# speaking, so a wider margin tells them apart.
TELNYX_BARGE_MARGIN_DB = float(os.environ.get("BRIDGE_TELNYX_BARGE_MARGIN_DB", "22"))
# How long to let it ring. Ofcom requires at least 15 seconds before abandoning
# an unanswered call, so this floor is a rule, not a preference.
TELNYX_RING_SECONDS = 30
# How long to wait for the media websocket AFTER the call is answered. Telnyx
# opens it on answer, not on dial, so this is only ever a few seconds. It is
# deliberately NOT the ring timeout: conflating the two turned "they were slow
# to pick up" into a fake websocket error on a live call.
TELNYX_ATTACH_TIMEOUT_S = 15.0

# ---------------------------------------------------------------------------
# Answerphone detection
# ---------------------------------------------------------------------------
# On the first US batch, one of two answered calls was Atlas Plumbing's
# voicemail. Maria delivered the whole pitch to it, for fifty-four seconds, and
# the ledger recorded "completed". At ordinary cold-call pickup rates that is
# about half of every batch: half the spend, and a results table that flatters
# itself.
#
# Telnyx runs the classifier on its own leg and reports over the webhook, so a
# HUMAN waits for nothing. That is why it beats deciding from our own
# transcript, which cannot know until the greeting is already several seconds
# in and the opener has been spoken over it.
AMD_ENABLED = os.environ.get("BRIDGE_AMD", "1") != "0"
# "detect" classifies human vs machine and stops there. "greeting_end" would
# also wait for the beep, which is only worth paying for if we ever decide to
# LEAVE a message; today a machine simply gets hung up on.
AMD_MODE = os.environ.get("BRIDGE_AMD_MODE", "detect")
# Telnyx can take a few seconds to decide, and until it does the opener is
# already playing. This is how long the call loop will go on waiting for a
# verdict before giving up and treating the call as human.
AMD_WAIT_S = float(os.environ.get("BRIDGE_AMD_WAIT_S", "8"))

# The backstop, for when Telnyx says "not_sure" or says nothing at all.
#
# These are phrases a PERSON answering their own business phone does not say.
# Deliberately short and unambiguous: "leave a message" is a machine, but
# "can I take a message" is a receptionist, so the list matches the machine's
# side of that pair only. Anything vaguer belongs nowhere near a rule that
# hangs up on people.
AMD_PHRASES = (
    "leave a message", "leave your name", "leave your number",
    "after the tone", "after the beep", "at the tone", "at the beep",
    "you have reached", "you've reached",
    "not available to take your call", "unable to take your call",
    "can't get to the phone", "cannot get to the phone",
    "our office is currently closed", "we are currently closed",
    "your call is important to us", "press one for", "press 1 for",
)

# The CARRIER's own voicemail intro, which is a different animal and needs no
# length check. A business greeting has to clear AMD_MIN_GREETING_WORDS because
# a receptionist saying "can I take a message" looks a lot like a machine. These
# do not: no human alive answers their phone by announcing that the call has
# been forwarded to voicemail, so the phrase alone is proof.
#
# The gap was real. "+17086925510" was carrier voicemail, said "Your call has
# been forwarded to voicemail", and was filed as COMPLETED, because the phrase
# was not on the list and the sentence was too short to trip the length rule.
# That flatters the results table with conversations that never happened.
AMD_PHRASES_CERTAIN = (
    "forwarded to voicemail", "the person you are trying to reach",
    "the person you're trying to reach",
    "please record your message", "record your message at",
    "leave a detailed message", "has a voice mailbox", "voicemail box",
    "subscriber you have dialed", "subscriber you have dialled",
    "please leave a message after",
)
# "is not available" was on that list for about a minute and is the reason this
# note exists. It is the tail of the carrier line "the person you're trying to
# reach is not available", and it is ALSO what a receptionist says about her
# boss: "He is not available right now, can I take a message?". On the certain
# list, with no length check to save it, that hung up on a human. Tested, it
# really did. The distinctive half of the carrier line is "the person you're
# trying to reach", so match on that and never on the tail.
# A human answering a phone says a handful of words and then stops to listen.
# A greeting runs on. Used only together with a phrase hit, never alone, since
# a chatty receptionist reading out opening hours would otherwise be cut off.
AMD_MIN_GREETING_WORDS = 12

# ---------------------------------------------------------------------------
# Ending the call
# ---------------------------------------------------------------------------
# Hugo, 2026-07-29: "when she finished the call, don't hang up immediately, no?"
#
# He is right, and it is two faults in one. Her closing line is still PLAYING
# when the loop decides the call is over, because _play_until is in the future
# at that moment, so cutting the line there chops her last few words off. And
# even once she has finished, a person does not drop the line the instant they
# stop speaking: there is a beat where the other party says "cheers" or "bye",
# and hanging up through that is the rudest thing on a phone call.
#
# So: wait for her audio to actually finish, THEN hold the line briefly.
HANGUP_DRAIN_MAX_S = float(os.environ.get("BRIDGE_HANGUP_DRAIN_MAX_S", "6"))
HANGUP_PAUSE_S = float(os.environ.get("BRIDGE_HANGUP_PAUSE_S", "1.6"))

# --- Device ----------------------------------------------------------------
ADB_SERIAL = os.environ.get("BRIDGE_ADB_SERIAL")  # None = first device found
# The handset's own automatic gain control amplifies a quiet input and clips it,
# so a lower playback level reaches the far end cleaner than a loud one.
# Measured on a Galaxy A16: 100% clipped at 0.0 dB, 65% was clean.
SPEAKER_VOLUME = int(os.environ.get("BRIDGE_SPEAKER_VOLUME", "65"))

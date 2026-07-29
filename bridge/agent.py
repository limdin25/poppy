"""The conversation loop.

Dial, wait for a real answer, open, then listen and reply until somebody hangs
up. Transport-agnostic: hand it a SimTransport today or a VoIP transport later.
"""
from __future__ import annotations

import json
import queue
import random
import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from . import ai, audio, config
from .transport import CaptureFailed, Transport

# One pattern, used both to detect the end-of-call marker and to strip it. They
# used to be separate, a literal "[END]" test and a whitespace-tolerant regex, so
# "[ END ]" was quietly removed from the speech and never ended the call: the
# agent agreed to take an annoyed prospect off the list, then stayed on the line.
_MARKER_RE = re.compile(r"\[\s*END\s*\]", re.IGNORECASE)
# Emotion cues are for the voice, not for the record. They must survive all the
# way to Fish, so they are stripped only where text is shown or stored.
_CUE_RE = re.compile(r"\[[a-z][a-z\s-]{0,20}\]", re.IGNORECASE)


def spoken_words(text: str) -> str:
    """What a human would say was said, with the performance cues removed."""
    return re.sub(r"\s+", " ", _CUE_RE.sub(" ", text)).strip()

# Rough speaking rate of the TTS voices, used only to estimate how much of a
# sentence actually reached the prospect before they cut in.
CHARS_PER_SECOND = 15.0


# Punctuation the model reaches for that we never use. Asking it not to in the
# prompt is not enough: on a live call it produced "that's a good question, a
# colleague will confirm" with a long dash in the middle, despite being told
# plainly not to. A model copies the punctuation it has seen, so this is
# enforced in code rather than remembered, the same way the SMS copy rule is.
_PUNCTUATION = {
    "—": ",",   # em dash
    "–": ",",   # en dash
    "‒": ",",   # figure dash
    "−": "-",   # minus sign
    "‘": "'", "’": "'",           # curly single quotes
    "“": '"', "”": '"',           # curly double quotes
    "…": "...",                        # ellipsis character
    " ": " ",                          # non-breaking space
}


def straighten(text: str) -> str:
    """Replace punctuation we never use with the plain equivalent."""
    for bad, good in _PUNCTUATION.items():
        text = text.replace(bad, good)
    return text


def _strip_marker(text: str) -> str:
    """Remove the [END] control marker wherever the model put it, and tidy."""
    return re.sub(r"\s+", " ", straighten(_MARKER_RE.sub(" ", text))).strip()


def _has_marker(text: str) -> bool:
    return _MARKER_RE.search(text) is not None


# Words that mean the thought is still going, even though the sound stopped.
# Somebody saying "we've got about twenty, but" has not finished, and answering
# there talks over the important half of the sentence.
_UNFINISHED_TAIL = {
    "and", "but", "so", "or", "because", "cos", "if", "when", "while", "though",
    "although", "unless", "since", "that", "which", "who", "the", "a", "an",
    "to", "of", "for", "with", "at", "in", "on", "is", "was", "we", "i", "it",
    "they", "you", "my", "our", "their", "like", "just", "well", "erm", "um",
    "uh", "actually", "basically", "obviously", "yeah",
}


def sounds_unfinished(text: str) -> bool:
    """Does this look like somebody mid-thought rather than done?

    Silence is not the same as finishing. "Don't answer just because there's
    silence. Wait if the thought feels unfinished." A trailing conjunction or a
    dangling article is the clearest signal there is more coming.

    Deliberately conservative: it only holds on for an obvious cue, because
    waiting when they HAVE finished is its own kind of rude.
    """
    words = re.sub(r"[^\w\s']", " ", text.lower()).split()
    if not words:
        return False
    if text.rstrip().endswith(","):
        return True
    # A single word is a complete answer far more often than not ("yeah",
    # "twenty", "no"), so never hold on one.
    if len(words) < 2:
        return False
    return words[-1] in _UNFINISHED_TAIL


def _clip_reply(tokens, spoken: list[str], max_words: int | None = None):
    """Cut the reply short, in code, at the first of two limits.

    A person asks one thing and then shuts up. The model does not: it will ask
    "how many reviews have you got?" and carry straight on into the pitch, so the
    prospect starts answering and gets talked over. Hugo, after a live call:
    "she's talking over me all the time... she has to ask a question and wait,
    not keep talking after asking a question."

    Telling it not to in the prompt is not enough, because a streamed reply is
    already on its way to the voice by the time the sentence ends. So:

      - a question mark ends the turn wherever it lands, mid-token if need be
      - past MAX_SPOKEN_WORDS the turn ends at the next full stop, so she
        finishes the sentence she is in rather than stopping mid-clause
      - twice the cap is a hard stop, for a reply that never punctuates at all

    Anything before the question still plays, so "Fair question. A colleague
    will explain. So are you the right person?" keeps all three parts and stops
    at the end.

    Whatever is actually yielded is appended to `spoken`. That list, not the
    model's full output, is the truth about what the prospect heard. Recording
    the untruncated reply meant the transcript claimed lines that were never
    said, and worse, the model believed it had already said them and moved on.
    """
    if max_words is None:
        max_words = config.MAX_SPOKEN_WORDS
    done = False
    text = ""
    for token in tokens:
        if done:
            continue                       # drain, so the socket closes cleanly
        text += token
        words = text.count(" ")
        cut = None
        if "?" in token:
            cut = token.index("?") + 1
        elif words >= max_words:
            ends = [token.index(c) for c in ".!" if c in token]
            if ends:
                cut = min(ends) + 1
            elif words >= max_words * 2:
                cut = len(token)           # it is never going to stop on its own
        if cut is None:
            spoken.append(token)
            yield token
        else:
            piece = token[:cut]
            if piece:
                spoken.append(piece)
                yield piece
            done = True


# The acknowledgement words, as they appear at the START of a written reply.
# The optional group is a cue tag, which must survive: "[curious] Right, so..."
# has to become "[curious] so...", not "so...".
_ACK_OPENER = re.compile(
    r"^(\s*\[[a-z][a-z\s-]{0,20}\]\s*)?"
    r"(right|okay|ok|yeah|yep|yes|sure|gotcha|got it|mm+|mm hmm|no worries|"
    r"fair enough|absolutely|of course)"
    r"\s*[,.!]+\s*",
    re.IGNORECASE,
)


def _drop_leading_ack(tokens):
    """Do not say the acknowledgement twice.

    The backchannel plays "Right." while the model is still writing. The model
    then writes "Right. And are you asking customers now?" of its own accord: it
    did it on three runs out of three when measured. So the prospect hears
    "Right." ... "Right. And are you..." and it sounds exactly like Hugo said it
    did, "saying thing like Right / yeah when makes no sense and no context".

    Two independent sources of the same filler word. The backchannel keeps the
    job, because it is what covers the thinking gap, and the model's copy is
    removed here.

    Only used on turns where an acknowledgement actually played, so the small
    buffering delay is never paid on the turns that did not have one.
    """
    buf = ""
    decided = False
    for token in tokens:
        if decided:
            yield token
            continue
        buf += token
        if len(buf) < 28:
            continue                       # not yet enough to judge
        decided = True
        head = _ACK_OPENER.sub(lambda m: m.group(1) or "", buf, count=1)
        if head:
            yield head
    if not decided and buf:
        head = _ACK_OPENER.sub(lambda m: m.group(1) or "", buf, count=1)
        if head:
            yield head


def clean_cues(tokens):
    """Drop any bracketed cue that is not on the verified-safe list.

    Fish takes free-form natural language in brackets, so the prompt listing six
    permitted cues is a suggestion the model is free to improvise around, and it
    does. [chuckling] measured 0.93 seconds longer than the bare line: that is
    not a delivery difference, that is her laughing. Hugo has now reported the
    laugh twice.

    So the list is enforced here instead, on the way to the voice, the same way
    the long-dash rule is enforced in code rather than remembered.

    A cue can be split across tokens ("[", "chuck", "ling]"), so an unclosed
    bracket is held back until the closing one arrives. Anything still held when
    the stream ends is dropped rather than spoken: a stray "[chuck" down the
    phone is worse than a missing cue nobody would have noticed.
    """
    held = ""
    for token in tokens:
        text, held = held + token, ""
        out = []
        while text:
            start = text.find("[")
            if start < 0:
                out.append(text)
                break
            out.append(text[:start])
            end = text.find("]", start)
            if end < 0:
                held = text[start:]        # incomplete, wait for the rest
                break
            cue = text[start + 1:end].strip().lower()
            if config.CUES_ENABLED and cue in config.SAFE_CUES:
                out.append(f"[{cue}]")
            text = text[end + 1:]
        # Last stop before the voice, so the punctuation rule is enforced here
        # too. The streamed path never passed through straighten(), which only
        # ever ran on the opener and on the saved transcript, so a long dash in
        # a live reply reached Fish untouched. Newlines collapse for the same
        # reason: the model writes paragraphs, and nobody speaks in paragraphs.
        piece = re.sub(r"\s+", " ", straighten("".join(out)))
        if piece:
            yield piece


def _spoken_prefix(text: str, elapsed_ms: float) -> str:
    """Estimate the part of a sentence the prospect heard before interrupting.

    An estimate, not a measurement, but recording the whole line as delivered is
    a worse lie: the transcript then claims the AI disclosure was given when it
    was cut off after half a word.
    """
    chars = int((elapsed_ms / 1000.0) * CHARS_PER_SECOND)
    if chars >= len(text):
        return text
    cut = text[:chars]
    if " " in cut:
        cut = cut[: cut.rindex(" ")]
    return cut.strip()


@dataclass
class Turn:
    who: str
    text: str
    at: float


@dataclass
class CallResult:
    number: str
    answered: bool = False
    started_at: float = 0.0
    ended_at: float = 0.0
    turns: list[Turn] = field(default_factory=list)
    outcome: str = "unknown"
    error: str | None = None

    @property
    def duration(self) -> float:
        return max(0.0, self.ended_at - self.started_at)

    def to_dict(self) -> dict:
        return {
            "number": self.number,
            "answered": self.answered,
            "duration_s": round(self.duration, 1),
            "outcome": self.outcome,
            "error": self.error,
            "turns": [{"who": t.who, "text": t.text, "at": round(t.at, 1)} for t in self.turns],
        }


class Agent:
    def __init__(
        self,
        transport: Transport,
        system_prompt: str,
        opener: str,
        stt: ai.SpeechToText | None = None,
        tts: ai.TextToSpeech | None = None,
        on_event=None,
    ):
        self.transport = transport
        self.stt = stt or ai.WhisperSTT()
        self.tts = tts or ai.build_tts()
        self.brain = ai.Brain(system_prompt)
        self.opener = opener
        self.on_event = on_event or (lambda kind, text: None)
        # Replaced with this line's measured quiet level once the call connects.
        self._baseline = -55.0
        # When the prospect stopped talking, so lag can be measured honestly.
        self._heard_at = 0.0
        # A live voice stream, if the caller handed one over. When present every
        # reply starts speaking in about a quarter of a second instead of
        # waiting for the whole clip to render.
        self.voice_stream = None
        # A live transcription socket, if the caller handed one over. When
        # present it replaces the VAD, the end-of-turn wait and batch Whisper.
        self.ears = None
        self._backchannel: list[tuple[str, bytes]] = []
        # Generate the opener NOW, while the phone is still ringing, instead of
        # after they say hello. It used to be made on answer, so its generation
        # time landed as dead air at the very start of every call, which is the
        # worst possible place for it. Nobody is waiting during the ring.
        self._opener_audio: bytes | None = None
        threading.Thread(target=self._prepare_opener, daemon=True).start()
        threading.Thread(target=self._prepare_backchannel, daemon=True).start()

    def _prepare_opener(self) -> None:
        try:
            self._opener_audio = self.tts.say(straighten(self.opener))
        except Exception as e:
            self._emit("error", f"opener TTS failed, will retry on answer: {e}")

    def _prepare_backchannel(self) -> None:
        """Generate the little acknowledgements up front, during the ring.

        These are what a person makes while they are thinking: "mm", "right",
        "yeah". They matter more than they look. The model takes a second or so
        to answer and the voice another fraction on top, and that gap is dead
        air, which is the single most robotic thing on a call. Playing one of
        these the instant the prospect stops talking fills the gap with
        something a human would actually do, and it costs no extra time because
        it plays while the model is still writing.

        Generated once, at startup, so using one costs nothing at all later.
        """
        for word in config.BACKCHANNEL_WORDS:
            try:
                self._backchannel.append((word, self.tts.say(word)))
            except Exception:
                return  # not worth failing a call over

    def _pick_backchannel(self, heard: str = "") -> tuple[str, bytes] | None:
        """An acknowledgement, but only where one actually makes sense.

        This used to fire on a 45% coin flip regardless of what was said, which
        produced exactly what Hugo heard: "Right." and "Yeah." dropped in with
        no context, including in reply to "who is this?". You do not say "Right"
        to a question. You say it when somebody has just TOLD you something.

        So: only after a statement, never after a question, and never after a
        one-word reply where an acknowledgement is longer than the thing it is
        acknowledging.
        """
        if not self._backchannel:
            return None
        text = heard.strip()
        if not text or text.endswith("?"):
            return None
        if len(text.split()) < 3:
            return None
        # Questions do not always carry a question mark once transcribed.
        first = text.lower().split()[0]
        if first in {"who", "what", "why", "when", "where", "how", "is", "are",
                     "do", "does", "did", "can", "could", "would", "will"}:
            return None
        if random.random() > config.BACKCHANNEL_CHANCE:
            return None
        return random.choice(self._backchannel)

    def _emit(self, kind: str, text: str) -> None:
        self.on_event(kind, text)

    def _play(self, text: str, payload: bytes) -> tuple[str, bool]:
        """Play one piece of speech. Returns (what they actually heard, cut off?).

        Both the opener and the streamed replies go through here, and that is the
        point. They used to be two copies, and only one of them was ever hardened
        against the far end's handset echoing our own voice back down the line. So
        every call cut its own opener off, taking the AI disclosure with it, while
        the transcript recorded the line as delivered in full.
        """
        # Whatever arrived while this audio was being generated is stale. Left in
        # the queue it is replayed at memory speed the instant we start listening,
        # and a second of backlog looks exactly like a sustained interruption, so
        # the reply dies before a syllable is audible.
        self.transport.drain()

        # A generator means the voice is still being produced, so hand it over
        # and let the transport play it as it arrives. Bytes mean it is already
        # rendered and plays in one go, which is what the SIM rig does.
        if hasattr(payload, "__next__") or hasattr(payload, "__iter__") and not isinstance(payload, (bytes, bytearray)):
            self.transport.speak_stream(payload)
        else:
            self.transport.speak(payload)
        started = time.monotonic()
        announced = False
        # Read the thresholds off the transport, not the global config. What
        # counts as an interruption depends entirely on whether that transport
        # can hear its own voice coming back, and the two answers are far apart.
        barge = audio.VoiceActivity(margin_db=self.transport.barge_margin_db)
        interrupted = False

        while self.transport.is_speaking():
            chunk = self.transport.read(timeout=0.15)
            if chunk is None:
                continue
            # Measure the grace window from when sound actually started leaving
            # for the far end. With streaming that is ~300ms after we asked, and
            # timing it from the request meant the window was already spent
            # before she made a noise, so the opener was cut off every call.
            began = self.transport.audio_started_at() or started
            # Report the gap that actually matters: prospect stopped talking, to
            # first sound out. Logging only when she FINISHES made a six second
            # reply look like six seconds of lag, which is unmeasurable nonsense.
            if not announced and self.transport.audio_started_at() and self._heard_at:
                announced = True
                self._emit("lag", f"{(began - self._heard_at) * 1000:.0f}ms to first word")
            elapsed_ms = (time.monotonic() - began) * 1000.0
            if elapsed_ms < self.transport.barge_grace_ms:
                # The echo of our own first syllable lands inside this window.
                # Reset rather than skip: letting the counter run up during the
                # grace period just moves the false trigger to the moment it ends.
                barge.reset()
                continue
            _, speech_ms, _ = barge.feed(chunk)
            if config.BARGE_IN_ENABLED and speech_ms >= self.transport.barge_min_ms:
                # Let the word in flight land before cutting. Stopping the
                # instant we decide chops a syllable in half, which sounds
                # broken rather than polite. Hugo: "you don't stop mid-word, you
                # can stop mid-sentence, but never mid-word." A couple of
                # hundred milliseconds is about one word at speaking pace.
                time.sleep(config.FINISH_WORD_MS / 1000.0)
                self.transport.stop_speaking()
                self._emit("bargein", "prospect interrupted")
                interrupted = True
                break

        if not interrupted:
            return text, False
        return _spoken_prefix(text, (time.monotonic() - started) * 1000.0), True

    def _settle(self) -> None:
        """Let our own echo pass before listening.

        Draining once at the instant playback stops is not enough, because the
        tail of the echo is still in flight down the line. Without the pause the
        agent transcribes its own voice and answers itself.
        """
        self.transport.drain()
        time.sleep(self.transport.echo_settle_ms / 1000.0)
        self.transport.drain()

    def _say(self, text: str, result: CallResult) -> bool:
        """Speak one fixed line, such as the opener. Returns True if cut off."""
        text = straighten(text)
        payload = self._opener_audio if text == straighten(self.opener) else None
        if payload is None:
            try:
                payload = self.tts.say(text)
            except Exception as e:
                self._emit("error", f"TTS failed: {e}")
                return False

        spoken, interrupted = self._play(text, payload)
        self._settle()

        # Recorded after playback, and only what was delivered. Appending before
        # speaking meant a TTS failure or a barge-in still produced a transcript
        # claiming the whole line, disclosure included, had been spoken.
        words = spoken_words(spoken)
        if words:
            self._emit("ai", words)
            result.turns.append(
                Turn("ai_truncated" if interrupted else "ai", words,
                     time.time() - result.started_at)
            )
        return interrupted

    def _say_live(self, heard: str, result: CallResult) -> tuple[bool, bool]:
        """Claude's tokens straight into Fish, no sentence buffering anywhere.

        The fastest path there is. Waiting for a complete sentence before
        starting to speak costs about a second per reply, and Fish decides for
        itself when it has enough text to synthesise naturally, so the model and
        the voice run at the same time instead of one after the other.

        Returns (saw end marker, was interrupted).
        """
        # Two lists on purpose. `written` is everything the model produced, and
        # is what the end-of-call marker is looked for in, because [END] often
        # lands after the point the reply was cut. `spoken` is only what got as
        # far as the voice, and is the only honest basis for the transcript.
        written: list[str] = []
        spoken: list[str] = []
        # Chosen before the stream is built, because whether an acknowledgement
        # played decides whether the model's own copy of it has to be removed.
        # Nothing has run yet: stream_tokens is a generator, so the request does
        # not leave until the first token is pulled.
        ack = self._pick_backchannel(heard)
        raw = self.brain.stream_tokens(heard, seen=written)
        if ack is not None:
            raw = _drop_leading_ack(raw)
        tokens = clean_cues(_clip_reply(raw, spoken))

        if ack is not None:
            # Plays over the model's first tokens, so it costs nothing.
            self._emit("ai", ack[0])
            self._play(*ack)

        chunks = self.voice_stream.stream_tokens(tokens)
        _, interrupted = self._play("", chunks)
        self._settle()

        full = "".join(written)
        words = spoken_words(_strip_marker("".join(spoken)))
        # Correct the model's own record to what actually left the phone. Left
        # uncorrected it believes it delivered the half of the reply that was
        # cut off, so it never says it, and the call quietly loses the thread.
        self.brain.amend_last(words)
        # Tell the transcriber what she just said. Their docs: biggest impact on
        # short replies ("yes", "about twenty", a name), which on a sales call
        # is most of them.
        if words and self.ears is not None:
            self.ears.set_agent_context(words)
        if words:
            self._emit("ai", words)
            result.turns.append(
                Turn("ai_truncated" if interrupted else "ai", words,
                     time.time() - result.started_at)
            )
        return _has_marker(full), interrupted

    def _say_stream(self, sentences, result: CallResult) -> tuple[bool, bool]:
        """Speak sentences as the model writes them.

        The first sentence is usually ready in a few hundred milliseconds, so
        speech starts about a second sooner than waiting for the whole reply.
        TTS for later sentences is generated while earlier ones are still
        playing, so there is no gap between them.

        Returns (saw_end_marker, was_interrupted).
        """
        audio_q: queue.Queue = queue.Queue()
        saw_end = threading.Event()
        stop_producing = threading.Event()

        def produce():
            try:
                for sentence, _is_final in sentences:
                    if stop_producing.is_set():
                        break
                    if _has_marker(sentence):
                        saw_end.set()
                    clean = _strip_marker(sentence)
                    if not clean:
                        continue
                    try:
                        if self.voice_stream is not None:
                            # Not rendered yet: the transport pulls audio out of
                            # this as Fish produces it.
                            audio_q.put((clean, self.voice_stream.stream(clean)))
                        else:
                            audio_q.put((clean, self.tts.say(clean)))
                    except Exception as e:
                        self._emit("error", f"TTS failed: {e}")
            except Exception as e:
                self._emit("error", f"LLM stream failed: {e}")
            finally:
                audio_q.put(None)

        # Starting the producer FIRST is what makes the acknowledgement free:
        # the model begins writing immediately, and the "mm" plays over the top
        # of it rather than before it.
        threading.Thread(target=produce, daemon=True).start()

        interrupted = False
        spoken: list[str] = []

        ack = self._pick_backchannel()
        if ack is not None:
            self._emit("ai", ack[0])
            self._play(*ack)
        while True:
            item = audio_q.get()
            if item is None:
                break
            text, payload = item
            if interrupted:
                continue  # drain the rest, do not speak over the prospect
            said, interrupted = self._play(text, payload)
            if said:
                words = spoken_words(said)
                if words:
                    self._emit("ai", words)
                    spoken.append(words)
            if interrupted:
                stop_producing.set()

        self._settle()
        if spoken:
            result.turns.append(
                Turn("ai_truncated" if interrupted else "ai",
                     " ".join(spoken), time.time() - result.started_at)
            )
        return saw_end.is_set(), interrupted

    def _listen_streaming(self, result: CallResult) -> str:
        """Wait for AssemblyAI to say a turn finished.

        There is no VAD here and no end-of-turn wait, because AssemblyAI is
        already listening continuously and decides for itself when somebody has
        stopped. The text exists the moment they finish, which is the whole
        point: the old path spent 250ms waiting for silence and another 478ms
        uploading, both of them AFTER the prospect had finished speaking.

        Audio is pumped over by the transport's reader, not from here.
        """
        deadline = time.time() + config.AAI_TURN_TIMEOUT_S
        while time.time() < deadline:
            if time.time() - result.started_at > config.MAX_CALL_SECONDS:
                return ""
            if not self.transport.is_live():
                return ""
            text = self.ears.next_turn(timeout=0.15)
            if text is None:
                # Nothing confirmed yet. But if their partial has stopped
                # growing they have actually stopped talking, and waiting for
                # AssemblyAI to say so costs about two seconds. Acting on the
                # pause is what a person does: you answer when someone stops,
                # not when you have proof they finished.
                early = self.ears.settled_partial(config.SETTLED_PARTIAL_S)
                if early and not sounds_unfinished(early):
                    self.ears.accept(early)   # so its final is not answered twice
                    text = early
                else:
                    continue
            if not text:
                return ""         # socket closed
            # They stopped making noise, but did they stop talking? If the
            # thought is obviously unfinished, give them a moment and join it up
            # rather than answering half a sentence.
            if sounds_unfinished(text):
                more = self.ears.next_turn(timeout=config.UNFINISHED_WAIT_S)
                if more:
                    text = f"{text} {more}".strip()
            self._heard_at = time.monotonic()
            self._emit("them", text)
            result.turns.append(Turn("them", text, time.time() - result.started_at))
            return text
        return ""

    def _listen(self, result: CallResult) -> str:
        """Collect audio until they stop talking, then transcribe it."""
        vad = audio.VoiceActivity()
        vad.calibrate(self._baseline)
        buffer = bytearray()
        speech_ms = 0.0
        tail_silence_ms = 0.0
        heard_speech = False
        started = time.time()
        last_audio_at = time.time()

        while True:
            if time.time() - result.started_at > config.MAX_CALL_SECONDS:
                return ""
            # If the transport knows the call is over, stop waiting to be told
            # by silence. Inferring it costs about nine seconds a call.
            if not self.transport.is_live():
                return ""
            chunk = self.transport.read(timeout=0.4)
            if chunk is None:
                # Unconditional. This used to be gated on "we have not heard
                # anyone yet", which made it unreachable the moment somebody
                # spoke, so a line that died mid-sentence span silently until the
                # seven minute cap and logged itself as max_duration.
                if time.time() - last_audio_at > config.DEAD_LINE_S:
                    return ""
                if not heard_speech and time.time() - started > 25:
                    return ""
                continue
            last_audio_at = time.time()

            is_speech, _, silence_ms = vad.feed(chunk)
            if is_speech:
                heard_speech = True
                speech_ms += audio.ms_of(chunk)
            if heard_speech:
                buffer.extend(chunk)
            if heard_speech and silence_ms >= config.END_OF_TURN_SILENCE_MS:
                tail_silence_ms = silence_ms
                break
            # Backstop, so no VAD state can ever hold the turn open forever.
            if heard_speech and audio.ms_of(bytes(buffer)) >= config.MAX_UTTERANCE_MS:
                break
            if not heard_speech and time.time() - started > 25:
                return ""

        # Gate on the SPEECH in the buffer, never the buffer's own length. The
        # buffer always ends with the silence that closed the turn, so a length
        # test can never fail: one 21ms click uploaded 700ms of near-silence,
        # the STT invented "Thank you.", and the agent answered it out loud.
        if speech_ms < config.MIN_UTTERANCE_MS:
            return ""
        try:
            text = self.stt.transcribe(audio.trim_tail(bytes(buffer), tail_silence_ms))
        except Exception as e:
            self._emit("error", f"STT failed: {e}")
            return ""
        self._heard_at = time.monotonic()
        if text:
            self._emit("them", text)
            result.turns.append(Turn("them", text, time.time() - result.started_at))
        return text

    def call(self, number: str) -> CallResult:
        result = CallResult(number=number, started_at=time.time())
        try:
            self.transport.prepare()

            self._emit("dial", number)
            self.transport.dial(number)

            if not self.transport.wait_for_audio(config.NO_AUDIO_TIMEOUT_S):
                result.outcome = "no_answer"
                self._emit("outcome", "no answer")
                return result

            result.answered = True
            self._emit("answered", "audio detected, they picked up")

            # Measure this line's own quiet level rather than judging it against
            # a hardcoded guess. A van hands-free and a quiet kitchen are 20 dB
            # apart and the same fixed threshold cannot serve both.
            self._baseline = self.transport.baseline_level()

            # Let THEM speak first. Whoever picks up a phone says "hello", and
            # a caller who starts talking over that sounds like a machine that
            # was already running. Hugo, hearing exactly that: "when calling she
            # should not talk first". So wait a beat for their greeting, and only
            # open into silence if none comes.
            greeting = ""
            if self.ears is not None:
                waited = time.time()
                while time.time() - waited < config.WAIT_FOR_HELLO_S:
                    if not self.transport.is_live():
                        break
                    got = self.ears.next_turn(timeout=0.2)
                    if got:
                        greeting = got
                        break
                    early = self.ears.settled_partial(config.SETTLED_PARTIAL_S)
                    if early:
                        self.ears.accept(early)
                        greeting = early
                        break
            if greeting:
                self._emit("them", greeting)
                result.turns.append(Turn("them", greeting, time.time() - result.started_at))
                self._heard_at = time.monotonic()

            cut_off = self._say(self.opener, result)
            # The model has to know what it already said, or it introduces itself
            # again on the next turn. If the opener was cut short it also has to
            # know the AI disclosure may not have landed, because saying it is
            # required by Anthropic's and ElevenLabs' policies, not optional.
            self.brain.note_opening(self.opener, truncated=cut_off)

            quiet_rounds = 0
            while time.time() - result.started_at < config.MAX_CALL_SECONDS:
                if not self.transport.is_live():
                    result.outcome = "far_end_hungup"
                    break
                heard = (self._listen_streaming(result) if self.ears is not None
                         else self._listen(result))
                if not heard:
                    quiet_rounds += 1
                    if quiet_rounds >= 2:
                        result.outcome = "went_quiet"
                        break
                    continue
                quiet_rounds = 0

                # The model puts [END] wherever it likes, start or end, so it is
                # detected anywhere and always stripped before speaking. Saying
                # the literal text "[END]" down the phone would be humiliating.
                try:
                    if self.voice_stream is not None:
                        ends, _interrupted = self._say_live(heard, result)
                    else:
                        ends, _interrupted = self._say_stream(
                            self.brain.stream_sentences(heard), result
                        )
                except Exception as e:
                    result.error = str(e)
                    self._emit("error", f"LLM failed: {e}")
                    break
                if ends:
                    result.outcome = "completed"
                    break
            else:
                result.outcome = "max_duration"

        except CaptureFailed as e:
            # A broken rig, not a prospect who did not answer. Saying so is the
            # difference between fixing scrcpy and wrongly retrying a lead.
            result.outcome = "capture_failed"
            result.error = str(e)
            self._emit("error", f"CAPTURE FAILED, nobody could hear anything: {e}")
        except KeyboardInterrupt:
            result.outcome = "aborted"
        except Exception as e:
            result.error = str(e)
            result.outcome = "error"
            self._emit("error", str(e))
        finally:
            result.ended_at = time.time()
            # Teardown never raises out of here. An exception escaping this block
            # skipped the transcript save entirely, losing the whole conversation.
            try:
                self.transport.hangup()
            except Exception as e:
                result.error = "; ".join(filter(None, [result.error, f"hangup: {e}"]))
                self._emit("error", f"CHECK THE PHONE, hangup not confirmed: {e}")
            try:
                self.transport.close()
            except Exception as e:
                self._emit("error", f"cleanup failed: {e}")
            self._emit("hangup", f"{result.duration:.0f}s, {result.outcome}")
        return result


def save_transcript(result: CallResult, directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(result.started_at))
    safe = "".join(c for c in result.number if c.isdigit() or c == "+")
    path = directory / f"{stamp}-{safe}.json"
    path.write_text(json.dumps(result.to_dict(), indent=2))
    return path

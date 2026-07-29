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
        self._backchannel: list[tuple[str, bytes]] = []
        threading.Thread(target=self._prepare_backchannel, daemon=True).start()

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

    def _pick_backchannel(self) -> tuple[str, bytes] | None:
        if not self._backchannel or random.random() > config.BACKCHANNEL_CHANCE:
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

        self.transport.speak(payload)
        started = time.monotonic()
        # Read the thresholds off the transport, not the global config. What
        # counts as an interruption depends entirely on whether that transport
        # can hear its own voice coming back, and the two answers are far apart.
        barge = audio.VoiceActivity(margin_db=self.transport.barge_margin_db)
        interrupted = False

        while self.transport.is_speaking():
            chunk = self.transport.read(timeout=0.15)
            if chunk is None:
                continue
            elapsed_ms = (time.monotonic() - started) * 1000.0
            if elapsed_ms < self.transport.barge_grace_ms:
                # The echo of our own first syllable lands inside this window.
                # Reset rather than skip: letting the counter run up during the
                # grace period just moves the false trigger to the moment it ends.
                barge.reset()
                continue
            _, speech_ms, _ = barge.feed(chunk)
            if config.BARGE_IN_ENABLED and speech_ms >= self.transport.barge_min_ms:
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
        if spoken:
            self._emit("ai", spoken)
            result.turns.append(
                Turn("ai_truncated" if interrupted else "ai", spoken,
                     time.time() - result.started_at)
            )
        return interrupted

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
                self._emit("ai", said)
                spoken.append(said)
            if interrupted:
                stop_producing.set()

        self._settle()
        if spoken:
            result.turns.append(
                Turn("ai_truncated" if interrupted else "ai",
                     " ".join(spoken), time.time() - result.started_at)
            )
        return saw_end.is_set(), interrupted

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
                heard = self._listen(result)
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

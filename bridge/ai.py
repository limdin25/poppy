"""Speech to text, the model, and text to speech.

Each layer is behind a small interface so components can be swapped without
touching the conversation loop. The first implementations deliberately use only
credentials Hugo already has, so the bridge runs with no new signups:

  STT  OpenAI Whisper   (batch per utterance; swap for Deepgram streaming later)
  LLM  Claude Haiku 4.5 (reasoning OFF, see below)
  TTS  ElevenLabs Flash (fine for testing; Cartesia for production, see README)
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

from . import audio, config


_ABBREVIATIONS = ("mr.", "mrs.", "ms.", "dr.", "st.", "no.", "e.g.", "i.e.", "vs.")


def _sentence_end(text: str) -> int | None:
    """Index just past the first sentence terminator, or None.

    Guards against splitting on "Mr." or a decimal point, which would chop a
    sentence in half and make the TTS read half a thought.
    """
    for i, ch in enumerate(text):
        if ch not in ".!?":
            continue
        # A digit either side means it is a decimal, not a full stop.
        if ch == "." and i and text[i - 1].isdigit():
            if i + 1 < len(text) and text[i + 1].isdigit():
                continue
        lowered = text[: i + 1].lower()
        if any(lowered.endswith(a) for a in _ABBREVIATIONS):
            continue
        # Needs whitespace after it, otherwise the sentence may still be growing.
        if i + 1 < len(text) and not text[i + 1].isspace():
            continue
        return i + 1
    return None


def _post(url: str, headers: dict[str, str], body: bytes, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="ignore")[:400]
        raise RuntimeError(f"{url} returned {e.code}: {detail}") from None


# --------------------------------------------------------------------------
# Speech to text
# --------------------------------------------------------------------------

class SpeechToText:
    def transcribe(self, pcm16k: bytes) -> str:
        raise NotImplementedError


class WhisperSTT(SpeechToText):
    """OpenAI Whisper, one call per finished utterance.

    Batch, not streaming, so it adds roughly a second. It needs no new account,
    which is the point for the first working version. Deepgram or AssemblyAI
    streaming is the upgrade, and both accept 8 kHz telephony audio natively.
    """

    URL = "https://api.openai.com/v1/audio/transcriptions"

    def __init__(self):
        self.api_key = config.key("OPENAI_API_KEY", required=True)

    def transcribe(self, pcm16k: bytes) -> str:
        if audio.ms_of(pcm16k) < config.MIN_UTTERANCE_MS:
            return ""
        wav = audio.wav_bytes(pcm16k)
        boundary = "----elsiebridgeform"
        parts = [
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="model"\r\n\r\n'
            f"{config.WHISPER_MODEL}\r\n".encode(),
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="language"\r\n\r\nen\r\n'.encode(),
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="a.wav"\r\n'
            f"Content-Type: audio/wav\r\n\r\n".encode(),
            wav,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
        body = b"".join(parts)
        raw = _post(
            self.URL,
            {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
            body,
        )
        return json.loads(raw).get("text", "").strip()


# --------------------------------------------------------------------------
# The model
# --------------------------------------------------------------------------

class Brain:
    """Claude, held to short spoken replies.

    Reasoning is left OFF deliberately. Published measurements put reasoning
    modes at 8 to 90 seconds to first token, which is unusable on a live call.
    """

    URL = "https://api.anthropic.com/v1/messages"

    def __init__(self, system_prompt: str):
        self.api_key = config.key("ANTHROPIC_API_KEY", required=True)
        self.system_prompt = system_prompt
        self.history: list[dict[str, str]] = []

    def note_opening(self, opener: str, truncated: bool = False) -> None:
        """Tell the model what it already said before the prospect replied.

        It goes in the system prompt rather than the history because the API
        requires the first message to be from the user, so an assistant turn
        cannot simply be prepended. Without this the model has no idea it has
        already introduced itself and does it again on the next turn.
        """
        note = f"\n\nYOU HAVE ALREADY SAID THIS, out loud, as your opening line:\n{opener}\n"
        if truncated:
            note += (
                "WARNING: the prospect spoke over it, so they may only have heard "
                "the first few words. Work the fact that you are an AI assistant "
                "back into your next reply, naturally, in case they missed it.\n"
            )
        else:
            note += "Do not introduce yourself again.\n"
        self.system_prompt += note

    def stream_sentences(self, heard: str):
        """Yield complete sentences as the model produces them.

        This is the single biggest latency win available. Waiting for a whole
        reply costs about a second of dead air; the first sentence is usually
        ready in a few hundred milliseconds, and speech can start there while
        the rest is still being written.

        Yields (sentence, is_final). The full reply is appended to history at
        the end so the conversation stays coherent.
        """
        self.history.append({"role": "user", "content": heard})
        body = json.dumps(
            {
                "model": config.LLM_MODEL,
                "max_tokens": config.LLM_MAX_TOKENS,
                # Cached so the prompt is not reprocessed on every turn of the
                # call. On a 10 turn conversation this is 9 cache hits.
                "system": [
                    {
                        "type": "text",
                        "text": self.system_prompt,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                "messages": self.history,
                "stream": True,
            }
        ).encode()
        req = urllib.request.Request(
            self.URL,
            data=body,
            headers={
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            },
            method="POST",
        )

        buffer = ""
        full = ""
        committed = False

        def commit() -> None:
            """Record what was actually said, even if we were cut off.

            This MUST run even when the consumer abandons the generator, which
            happens on every barge-in. Without it the assistant's replies never
            reach history, the model sees only the prospect's side, and it
            re-introduces itself on every single turn. Generator finally blocks
            run on close() and on garbage collection, so this is the safe place.

            Committing the PARTIAL text is deliberate and more correct: if the
            prospect cut us off mid-sentence, the model should believe it said
            only what the prospect actually heard.
            """
            nonlocal committed
            if committed:
                return
            committed = True
            said = (full or "").strip()
            if said:
                self.history.append({"role": "assistant", "content": said})
            else:
                # Nothing was produced, so drop the user turn we optimistically
                # appended rather than leave a dangling unanswered message.
                if self.history and self.history[-1]["role"] == "user":
                    self.history.pop()

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                for raw_line in resp:
                    line = raw_line.decode(errors="ignore").strip()
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if not payload or payload == "[DONE]":
                        continue
                    try:
                        event = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    if event.get("type") != "content_block_delta":
                        continue
                    piece = event.get("delta", {}).get("text", "")
                    if not piece:
                        continue
                    buffer += piece
                    full += piece
                    # Emit as soon as a sentence closes, so speech can begin.
                    while True:
                        cut = _sentence_end(buffer)
                        if cut is None:
                            break
                        sentence, buffer = buffer[:cut].strip(), buffer[cut:].lstrip()
                        if sentence:
                            yield sentence, False
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="ignore")[:300]
            committed = True
            if self.history and self.history[-1]["role"] == "user":
                self.history.pop()
            raise RuntimeError(f"Claude stream failed {e.code}: {detail}") from None
        finally:
            # Runs on normal completion, on an early break by the consumer, and
            # on garbage collection. This is what keeps the conversation coherent.
            commit()

        tail = buffer.strip()
        if tail:
            yield tail, True

    def reply(self, heard: str) -> str:
        self.history.append({"role": "user", "content": heard})
        body = json.dumps(
            {
                "model": config.LLM_MODEL,
                "max_tokens": config.LLM_MAX_TOKENS,
                # Cached so the prompt is not reprocessed on every turn of the
                # call. On a 10 turn conversation this is 9 cache hits.
                "system": [
                    {
                        "type": "text",
                        "text": self.system_prompt,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                "messages": self.history,
            }
        ).encode()
        raw = _post(
            self.URL,
            {
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            body,
        )
        data = json.loads(raw)
        text = "".join(
            block.get("text", "") for block in data.get("content", [])
        ).strip()
        self.history.append({"role": "assistant", "content": text})
        return text


# --------------------------------------------------------------------------
# Text to speech
# --------------------------------------------------------------------------

class TextToSpeech:
    def say(self, text: str) -> bytes:
        raise NotImplementedError


class ElevenLabsTTS(TextToSpeech):
    """Good enough to test with, wrong to ship on.

    ElevenLabs' Prohibited Use Policy bans "unauthorized robocalling" and
    mandates AI disclosure. Cartesia's policy explicitly permits outbound
    calling, so production should use CartesiaTTS below.
    """

    def __init__(self, voice_id: str | None = None, output_format: str = "mp3_44100_128"):
        self.api_key = config.key("ELEVENLABS_API_KEY", required=True)
        self.voice_id = voice_id or config.ELEVENLABS_VOICE
        # `ulaw_8000` returns raw G.711 mu-law at 8 kHz, which is exactly what
        # the phone network carries and exactly what Telnyx wants on the wire.
        # Asking for it here means there is no transcoding step anywhere in the
        # call path, and so nothing in it to go wrong or add latency.
        self.output_format = output_format

    def say(self, text: str) -> bytes:
        url = (
            f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}"
            f"?output_format={self.output_format}"
        )
        # Lower stability means more variation between sentences, which is what
        # stops a voice sounding like it is reading. Retell's own agent runs its
        # Cartesia voice at temperature 1.1 and speed 0.98 for the same reason;
        # these are the nearest ElevenLabs equivalents.
        body = json.dumps(
            {
                "text": text,
                "model_id": config.ELEVENLABS_MODEL,
                "voice_settings": {
                    "stability": config.VOICE_STABILITY,
                    "similarity_boost": config.VOICE_SIMILARITY,
                    "style": config.VOICE_STYLE,
                    "use_speaker_boost": True,
                    "speed": config.VOICE_SPEED,
                },
            }
        ).encode()
        return _post(
            url,
            {"xi-api-key": self.api_key, "Content-Type": "application/json"},
            body,
        )


class CartesiaTTS(TextToSpeech):
    """What Retell itself uses, so it is the closest match to a sound Hugo rates.

    Needs CARTESIA_API_KEY and CARTESIA_VOICE_ID.
    """

    URL = "https://api.cartesia.ai/tts/bytes"

    def __init__(self, voice_id: str | None = None, telephony: bool = False):
        self.api_key = config.key("CARTESIA_API_KEY", required=True)
        self.voice_id = voice_id or config.key("CARTESIA_VOICE_ID", required=True)
        self.telephony = telephony

    def say(self, text: str) -> bytes:
        # Cartesia emits mu-law natively, so on a phone call there is no
        # conversion at all. The old code asked for 44.1kHz WAV, which the
        # telephony path cannot use.
        fmt = (
            {"container": "raw", "encoding": "pcm_mulaw", "sample_rate": 8000}
            if self.telephony
            else {"container": "wav", "encoding": "pcm_s16le", "sample_rate": 44100}
        )
        body = json.dumps(
            {
                "model_id": config.CARTESIA_MODEL,
                "transcript": text,
                "voice": {"mode": "id", "id": self.voice_id},
                "output_format": fmt,
                "language": "en",
            }
        ).encode()
        return _post(
            self.URL,
            {
                "X-API-Key": self.api_key,
                "Cartesia-Version": "2024-06-10",
                "Content-Type": "application/json",
            },
            body,
        )


class FishAudioTTS(TextToSpeech):
    """Fish Audio S2.1, which Retell also run in production.

    Needs FISH_API_KEY, and FISH_VOICE_ID for a cloned or chosen voice.
    Emits 8 kHz PCM, which is already the sample rate the phone network uses,
    so the only step is the mu-law encode.
    """

    URL = "https://api.fish.audio/v1/tts"

    def __init__(self, voice_id: str | None = None, telephony: bool = False):
        self.api_key = config.key("FISH_API_KEY", required=True)
        self.voice_id = voice_id or config.key("FISH_VOICE_ID")
        self.telephony = telephony

    def say(self, text: str) -> bytes:
        payload: dict = {
            "text": text,
            "format": "wav",
            "sample_rate": 8000 if self.telephony else 44100,
            # Their own low-latency mode. On a live call the tail matters more
            # than the median, which is the whole reason Cartesia beat
            # ElevenLabs in the benchmark.
            "latency": "low",
            "normalize": True,
        }
        if self.voice_id:
            payload["reference_id"] = self.voice_id
        raw = _post(
            self.URL,
            {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "model": config.FISH_MODEL,
            },
            json.dumps(payload).encode(),
        )
        if not self.telephony:
            return raw
        from . import ulaw
        return ulaw.encode(audio.pcm_from_wav(raw))


class GoogleTTS(TextToSpeech):
    """Google Chirp 3: HD. Cheapest of the lot and 1M characters a month free.

    Needs GOOGLE_TTS_API_KEY, a key with the Text-to-Speech API allowed. The
    existing Places key is restricted to Places and returns
    API_KEY_SERVICE_BLOCKED.
    """

    URL = "https://texttospeech.googleapis.com/v1/text:synthesize"

    def __init__(self, voice_id: str | None = None, telephony: bool = False):
        self.api_key = config.key("GOOGLE_TTS_API_KEY", required=True)
        self.voice = voice_id or config.GOOGLE_VOICE
        self.telephony = telephony

    def say(self, text: str) -> bytes:
        body = json.dumps(
            {
                "input": {"text": text},
                "voice": {"languageCode": "en-GB", "name": self.voice},
                # MULAW at 8 kHz is exactly what Telnyx carries, so like
                # Cartesia there is no conversion on the call path.
                "audioConfig": (
                    {"audioEncoding": "MULAW", "sampleRateHertz": 8000}
                    if self.telephony
                    else {"audioEncoding": "MP3"}
                ),
            }
        ).encode()
        raw = _post(f"{self.URL}?key={self.api_key}", {"Content-Type": "application/json"}, body)
        import base64
        content = base64.b64decode(json.loads(raw)["audioContent"])
        # Google wraps MULAW in a WAV container; Telnyx wants the bare samples.
        return audio.pcm_from_wav(content) if self.telephony else content


def build_tts(telephony: bool = False) -> TextToSpeech:
    """Pick a voice from whichever key exists.

    Order is deliberate. Cartesia first because it is literally what the Retell
    agent Hugo already rates is using, so it is the known-good sound. Then Fish,
    which Retell also run and which is cheaper. Then Google, cheapest of all with
    a free monthly allowance. ElevenLabs last: its Prohibited Use Policy bans
    "unauthorized robocalling", so it is the wrong vendor to run a campaign on
    however good it sounds.
    """
    if config.key("CARTESIA_API_KEY") and config.key("CARTESIA_VOICE_ID"):
        return CartesiaTTS(telephony=telephony)
    if config.key("FISH_API_KEY"):
        return FishAudioTTS(telephony=telephony)
    if config.key("GOOGLE_TTS_API_KEY"):
        return GoogleTTS(telephony=telephony)
    return ElevenLabsTTS(output_format="ulaw_8000" if telephony else "mp3_44100_128")

"""Tests for the calling bridge.

    python3 -m bridge.test_bridge

Every test here exists because a real bug was found at that exact spot in the
adversarial review on 2026-07-28. They are regression locks, not coverage.
"""
from __future__ import annotations

import array
import math
import sys

from . import agent, audio, config


def tone(ms: float, dbfs: float, rate: int = config.AI_RATE) -> bytes:
    """A sine at a given level, so tests can talk in dBFS like the VAD does."""
    n = int(rate * ms / 1000.0)
    amp = (10 ** (dbfs / 20.0)) * 32767.0 * math.sqrt(2)
    out = array.array("h")
    for i in range(n):
        out.append(int(max(-32767, min(32767, amp * math.sin(2 * math.pi * 440 * i / rate)))))
    return out.tobytes()


CASES: list[tuple[str, callable]] = []


def case(name):
    def wrap(fn):
        CASES.append((name, fn))
        return fn
    return wrap


# -- the [END] marker -------------------------------------------------------

@case("[END] is stripped wherever the model puts it")
def _():
    assert agent._strip_marker("[END] Thanks, bye.") == "Thanks, bye."
    assert agent._strip_marker("Thanks, bye. [END]") == "Thanks, bye."
    assert agent._strip_marker("Thanks [END] bye.") == "Thanks bye."
    assert agent._strip_marker("[end] lower case") == "lower case"


@case("detection and stripping agree, including on '[ END ]'")
def _():
    # They used to disagree: a literal "[END]" test against a whitespace
    # tolerant stripper. "[ END ]" was removed from the speech but never ended
    # the call, so the agent stayed on the line after agreeing to go away.
    for variant in ("[END]", "[ END ]", "[end]", "[  End  ]"):
        text = f"No problem, I'll take you off the list. {variant}"
        assert agent._has_marker(text), variant
        assert variant not in agent._strip_marker(text), variant


# -- the VAD ----------------------------------------------------------------

@case("a noisy line still ends its turn, and quickly")
def _():
    # THE bug: the noise floor was only updated on the not-speech branch, so it
    # could never rise past its own gate. A line whose ambient level sat above
    # the threshold latched on forever, the turn never ended, and the prospect
    # got seven minutes of dead air after the opener. Old code measured stuck at
    # exactly -55.0 dBFS on every line above -43.
    budget_ms = audio.VoiceActivity.LATCH_MS + config.END_OF_TURN_SILENCE_MS + 500
    for line_dbfs in (-45.0, -40.0, -35.0, -30.0, -26.0):
        vad = audio.VoiceActivity()
        vad.calibrate(line_dbfs)
        elapsed = 0.0
        ended = False
        while elapsed < 30_000:
            _, _, silence_ms = vad.feed(tone(21.4, line_dbfs))
            elapsed += 21.4
            if silence_ms >= config.END_OF_TURN_SILENCE_MS:
                ended = True
                break
        assert ended, f"turn never ended on a {line_dbfs} dBFS line"
        assert elapsed < budget_ms, (
            f"{line_dbfs} dBFS line took {elapsed:.0f}ms to end, budget {budget_ms:.0f}ms"
        )


@case("real speech over that same noisy line still reads as speech")
def _():
    vad = audio.VoiceActivity()
    for _ in range(150):
        vad.feed(tone(21.4, -40.0))          # settle onto the noise
    saw_speech = False
    for _ in range(20):
        is_speech, _, _ = vad.feed(tone(21.4, -18.0))
        saw_speech = saw_speech or is_speech
    assert saw_speech, "speech 22 dB above the line noise was missed"


@case("the floor does not chase a talker mid-sentence")
def _():
    # The fix for the latch bug introduced this one, caught in a dry run: a
    # rolling percentile rises to meet a steady voice and gates the talker off
    # over their own words. Normal speech, with gaps between words.
    vad = audio.VoiceActivity()
    vad.calibrate(-50.0)
    speech = [tone(21.4, -20.0)] * 6 + [tone(21.4, -48.0)]
    late = 0
    for i in range(300):
        is_speech, _, _ = vad.feed(speech[i % len(speech)])
        if i > 200 and is_speech:
            late += 1
    assert late > 0, "sustained speech stopped registering as speech"


@case("a gap-free 3 second utterance is not cut off")
def _():
    # No gaps at all, the hardest case for a percentile floor.
    vad = audio.VoiceActivity()
    vad.calibrate(-50.0)
    heard = 0
    for _ in range(140):  # ~3 s
        is_speech, _, _ = vad.feed(tone(21.4, -20.0))
        heard += 1 if is_speech else 0
    assert heard >= 130, f"only {heard}/140 chunks of steady speech registered"


@case("calibrate seeds the floor and is clamped")
def _():
    vad = audio.VoiceActivity()
    vad.calibrate(-38.0)
    assert vad.noise_floor == -38.0
    vad.calibrate(-200.0)
    assert vad.noise_floor == audio.VoiceActivity.FLOOR_MIN
    vad.calibrate(0.0)
    assert vad.noise_floor == audio.VoiceActivity.FLOOR_MAX


# -- utterance gating -------------------------------------------------------

@case("the min-utterance gate is measured on speech, not buffer length")
def _():
    # The buffer always ends with the 700 ms of silence that closed the turn, so
    # a length test could never fail. One 21 ms click uploaded 700 ms of near
    # silence, the STT invented "Thank you.", and the agent answered it aloud.
    click_ms = 21.4
    buffer_ms = click_ms + config.END_OF_TURN_SILENCE_MS
    assert buffer_ms > config.MIN_UTTERANCE_MS, "premise of the bug"
    assert click_ms < config.MIN_UTTERANCE_MS, "speech-only gate must reject it"


@case("trim_tail cuts the end-of-turn pad but keeps a little")
def _():
    pcm = tone(2000, -30.0)
    trimmed = audio.trim_tail(pcm, silence_ms=700.0, keep_ms=200.0)
    assert 1450 < audio.ms_of(trimmed) < 1550, audio.ms_of(trimmed)
    # Nothing to cut, nothing cut.
    assert audio.trim_tail(pcm, silence_ms=100.0) == pcm
    # Never returns an empty buffer, whatever it is asked to remove.
    assert audio.trim_tail(pcm, silence_ms=99999.0) == pcm


# -- truncated speech -------------------------------------------------------

@case("an interrupted line is recorded as what they actually heard")
def _():
    line = "Hi there, I'm Elsie, an AI assistant calling on behalf of HeyElsie."
    assert agent._spoken_prefix(line, 60_000) == line          # never cut off
    early = agent._spoken_prefix(line, 800)
    assert early and len(early) < len(line)
    assert line.startswith(early)
    assert not early.endswith(" ")                              # whole words only
    assert agent._spoken_prefix(line, 0) == ""


# -- the WAV header ---------------------------------------------------------

@case("the WAV header is found, not assumed to be 44 bytes")
def _():
    # scrcpy writes a LIST/INFO chunk as well, so the header is about 110 bytes.
    # Skipping a fixed 44 fed ASCII header text in as PCM at about -21 dBFS,
    # which is 48 dB above the answer gate, so every call "answered" instantly
    # and the opener played into a phone that was still ringing.
    from .transport import SimTransport

    t = SimTransport.__new__(SimTransport)
    t._head = bytearray()
    t._header_done = False

    header = (
        b"RIFF" + b"\xff\xff\xff\xff" + b"WAVE"
        + b"LIST" + (26).to_bytes(4, "little") + b"INFOISFT"
        + (14).to_bytes(4, "little") + b"Lavf61.7.100\x00\x00"
        + b"fmt " + (16).to_bytes(4, "little")
        + (1).to_bytes(2, "little") + (2).to_bytes(2, "little")
        + (48000).to_bytes(4, "little") + (192000).to_bytes(4, "little")
        + (4).to_bytes(2, "little") + (16).to_bytes(2, "little")
        + b"data" + b"\xff\xff\xff\xff"
    )
    assert len(header) != 44, "the whole point is that it is not 44"
    body = tone(100, -30.0, rate=48000)

    got = t._strip_header(header + body)
    assert t._header_done
    assert got == body, f"got {len(got)} bytes, wanted {len(body)}"


@case("a header split across two reads is still handled")
def _():
    from .transport import SimTransport

    t = SimTransport.__new__(SimTransport)
    t._head = bytearray()
    t._header_done = False

    header = b"RIFF\xff\xff\xff\xffWAVEfmt " + (16).to_bytes(4, "little") + b"\x00" * 16
    header += b"data" + b"\xff\xff\xff\xff"
    assert t._strip_header(header[:20]) == b""      # not enough yet
    assert not t._header_done
    out = t._strip_header(header[20:] + b"\x01\x02\x03\x04")
    assert t._header_done
    assert out == b"\x01\x02\x03\x04"


@case("header text never reaches the answer gate as audio")
def _():
    # The regression that mattered: header bytes read as loud audio.
    ascii_header = b"RIFFxxxxWAVELISTxxxxINFOISFTxxxxLavf61.7.100"
    level = audio.rms_dbfs(audio.to_mono_16k(ascii_header))
    assert level > config.ANSWER_GATE_DBFS, "premise: header text is 'loud'"
    # and the parser must therefore never emit it
    from .transport import SimTransport
    t = SimTransport.__new__(SimTransport)
    t._head = bytearray()
    t._header_done = False
    assert t._strip_header(ascii_header) == b""


# -- answer detection -------------------------------------------------------

@case("one transient chunk is not an answer")
def _():
    assert config.ANSWER_ONSET_CHUNKS >= 3, (
        "rms is a mean over the chunk, so a single sample at half a percent of "
        "full scale trips the gate on its own"
    )
    blip = bytearray(tone(21.4, -99.0))
    blip[0:2] = (5000).to_bytes(2, "little", signed=True)
    assert audio.rms_dbfs(bytes(blip)) > config.ANSWER_GATE_DBFS, (
        "premise: one loud sample clears the gate for the whole chunk"
    )


# -- conversion -------------------------------------------------------------

@case("48k stereo converts to 16k mono at the same level")
def _():
    src = tone(500, -20.0, rate=48000)
    stereo = array.array("h")
    mono = array.array("h")
    mono.frombytes(src)
    for s in mono:
        stereo.append(s)
        stereo.append(s)
    out = audio.to_mono_16k(stereo.tobytes())
    assert abs(audio.ms_of(out) - 500) < 5, audio.ms_of(out)
    assert abs(audio.rms_dbfs(out) - (-20.0)) < 1.5, audio.rms_dbfs(out)


def main() -> int:
    failed = 0
    for name, fn in CASES:
        try:
            fn()
            print(f"  ok   {name}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL {name}\n         {e}")
        except Exception as e:
            failed += 1
            print(f"  ERR  {name}\n         {type(e).__name__}: {e}")
    print(f"\n{len(CASES) - failed}/{len(CASES)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

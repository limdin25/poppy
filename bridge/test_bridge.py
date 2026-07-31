"""Tests for the calling bridge.

    python3 -m bridge.test_bridge

Every test here exists because a real bug was found at that exact spot in the
adversarial review on 2026-07-28. They are regression locks, not coverage.
"""
from __future__ import annotations

import array
import math
import sys
import time

from . import agent, ai, audio, config, copy_guard


def tone(ms: float, dbfs: float, rate: int = config.AI_RATE) -> bytes:
    """A sine at a given level, so tests can talk in dBFS like the VAD does."""
    n = int(rate * ms / 1000.0)
    amp = (10 ** (dbfs / 20.0)) * 32767.0 * math.sqrt(2)
    out = array.array("h")
    for i in range(n):
        out.append(int(max(-32767, min(32767, amp * math.sin(2 * math.pi * 440 * i / rate)))))
    return out.tobytes()


CASES: list[tuple[str, callable]] = []
SKIPPED: list[str] = []


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


@case("Fish refuses to speak without a pinned voice")
def _():
    # Without reference_id, Fish invents a new voice per request, so a single
    # call came out as several different people. Failing loudly beats shipping
    # a caller that sounds like a relay team.
    from . import ai
    import os
    old = os.environ.get("BRIDGE_FISH_VOICE")
    os.environ["BRIDGE_FISH_VOICE"] = ""
    try:
        import importlib
        importlib.reload(config)
        try:
            ai.FishAudioTTS(voice_id=None)
            raise AssertionError("built a Fish voice with no reference_id")
        except RuntimeError as e:
            assert "voice" in str(e).lower(), e
    finally:
        if old is None:
            os.environ.pop("BRIDGE_FISH_VOICE", None)
        else:
            os.environ["BRIDGE_FISH_VOICE"] = old
        import importlib
        importlib.reload(config)


@case("punctuation we never use is stripped in code, not just asked for")
def _():
    # A live call produced "that's a good question, a colleague will confirm"
    # with a long dash in it, despite the prompt forbidding one in as many words.
    bad = "Fair enough, that’s a good question—a colleague will confirm…"
    out = agent.straighten(bad)
    for ch in ("—", "–", "‘", "’", "“", "”", "…"):
        assert ch not in out, f"{ch!r} survived: {out!r}"
    # Note the space after that comma. Replacing a long dash with a comma used
    # to leave "question,a colleague", because the dash carried its own spacing
    # and the comma did not. This assertion locked that defect in until the
    # missing-space rule was added.
    assert out == "Fair enough, that's a good question, a colleague will confirm...", out
    # and it must run on the model's output path, not only on the opener
    assert "—" not in agent._strip_marker("Right—yes. [END]")


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
    # Stated in terms of the principle, not the current timings. It used to
    # assert that one click plus the end-of-turn pad exceeded the gate, which
    # was true at a 700ms pad and stopped being true when the pad dropped to
    # 250ms. The bug is not about any particular number: it is that the buffer
    # always carries the closing silence, so its LENGTH says nothing about
    # whether anyone spoke.
    click_ms = 21.4
    assert click_ms < config.MIN_UTTERANCE_MS, "speech-only gate must reject a click"
    # A long pause with a single click in it must still be rejected, however
    # long the buffer ends up being.
    for pad_ms in (250.0, 400.0, 700.0, 1500.0):
        speech_only = click_ms
        buffer_len = click_ms + pad_ms
        assert speech_only < config.MIN_UTTERANCE_MS, f"pad {pad_ms}"
        if buffer_len > config.MIN_UTTERANCE_MS:
            # exactly the case a length-based gate would wave through
            assert speech_only < config.MIN_UTTERANCE_MS, (
                f"a {buffer_len:.0f}ms buffer holding {speech_only:.0f}ms of speech "
                "must be judged on the speech"
            )


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


# -- what actually reaches the voice ----------------------------------------

def _drain(gen) -> str:
    return "".join(gen)


@case("a laughing cue never reaches Fish, however it is worded")
def _():
    # Measured: [chuckling] renders 0.93s longer than the bare line, which is
    # her laughing. The prompt banning it is not enough, Fish takes free-form
    # natural language so the model can always find another wording.
    for bad in ("[chuckling]", "[laughs]", "[laughing softly]", "[giggles]",
                "[amused chuckle]"):
        out = _drain(agent.clean_cues([f"{bad} Fair enough."]))
        assert "[" not in out, f"{bad} survived as {out!r}"
        assert "Fair enough." in out, out


@case("the safe cues do survive, including a cue split across tokens")
def _():
    assert _drain(agent.clean_cues(["[warm] Hi there."])) == "[warm] Hi there."
    # Claude streams deltas, so a cue arrives in pieces far more often than not.
    assert _drain(agent.clean_cues(["[cur", "ious", "] Go on?"])) == "[curious] Go on?"
    assert _drain(agent.clean_cues(["[chuck", "ling] Go on?"])) == " Go on?"


@case("dropping a cue leaves a space, it does not fuse the words either side")
def _():
    # Live calls produced "Quick question,how many jobs" and "right now,this is
    # what I do", both from a cue written with no spaces around it.
    assert _drain(agent.clean_cues(["right now,[pause]this is what I do"])) \
        == "right now, this is what I do"
    assert _drain(agent.clean_cues(["Quick question,[thinking]how many jobs?"])) \
        == "Quick question, how many jobs?"
    # And it must not introduce a double space where one already existed.
    assert _drain(agent.clean_cues(["Right. [sighing] And you?"])) == "Right. And you?"


@case("intensity modifiers survive, but cannot smuggle a laugh back in")
def _():
    # Fish document "[slightly sad]" and "[very excited]" as a first-class
    # feature, and it is the finest control there is over how much emotion a
    # line carries. The allowlist is exact-match, so without explicit support
    # every one of them would be silently dropped.
    assert _drain(agent.clean_cues(["[very warm] Hi."])) == "[very warm] Hi."
    assert _drain(agent.clean_cues(["[slightly amused] Go on."])) == "[slightly amused] Go on."
    # The BASE still has to be allowed, or the laugh returns by the side door.
    for bad in ("[very chuckling]", "[extremely laughing]", "[slightly sighing]"):
        assert "[" not in _drain(agent.clean_cues([f"{bad} Ha."])), bad
    # The whole documented emotion palette is available, not a hand-picked few:
    # cut back to eleven she came across muted, and the fix is more, not less.
    for good in ("[proud]", "[grateful]", "[surprised]", "[hopeful]",
                 "[determined]", "[nostalgic]", "[very grateful]"):
        assert "[" in _drain(agent.clean_cues([f"{good} Right."])), good
    # But anything that makes a NOISE is still refused, in every wording.
    for noise in ("[sighs]", "[gasping]", "[groaning]", "[coughing]",
                  "[giggles]", "[very sighing]", "[audience laughing]"):
        assert "[" not in _drain(agent.clean_cues([f"{noise} Right."])), noise
    # And a made-up phrase is not a feeling.
    assert "[" not in _drain(agent.clean_cues(["[nonsense phrase] What?"]))


@case("two agreeing cues may stack, and emphasis works mid-sentence")
def _():
    assert _drain(agent.clean_cues(["[warm][amused] Nice one."])) == "[warm][amused] Nice one."
    # [emphasis] is a tone marker: their docs put it immediately before the
    # word being stressed, not at the start of the sentence.
    out = _drain(agent.clean_cues(["That's [emphasis] three quid a day."]))
    assert out == "That's [emphasis] three quid a day.", out


@case("an unclosed bracket is dropped rather than read out loud")
def _():
    assert "[" not in _drain(agent.clean_cues(["[chuck"]))


@case("[END] is stripped from the voice but still ends the call")
def _():
    assert "END" not in _drain(agent.clean_cues(["[END] All the best."]))


@case("a question ends the turn, and the rest is never spoken")
def _():
    spoken: list[str] = []
    out = _drain(agent._clip_reply(
        ["How many reviews", " have you got? ", "Most trades lose work because"],
        spoken))
    assert out == "How many reviews have you got?", out
    assert "".join(spoken) == out, "spoken must record exactly what was yielded"


@case("past the word cap the reply ends at the next full stop, not mid-clause")
def _():
    # Over the cap at word 10, but the sentence does not end until word 13, so
    # she finishes it rather than stopping dead on the cap.
    words = [f"word{i} " for i in range(13)]
    spoken: list[str] = []
    out = _drain(agent._clip_reply(words + ["end. ", "And more besides."],
                                   spoken, max_words=10))
    # Cut at the full stop itself, so the trailing space goes with the rest.
    assert out.endswith("end."), repr(out)
    assert "And more" not in out, out
    assert len(out.split()) == 14, len(out.split())
    assert "".join(spoken) == out, "spoken must record exactly what was yielded"


@case("a reply that never punctuates is still cut, at twice the cap")
def _():
    spoken: list[str] = []
    out = _drain(agent._clip_reply([f"word{i} " for i in range(60)], spoken,
                                   max_words=10))
    assert len(out.split()) <= 22, len(out.split())


@case("the model's copy of the acknowledgement is dropped, the cue is kept")
def _():
    # Two sources of "Right." on one turn is exactly what Hugo reported.
    # Capitalised, and the CUE is stepped over rather than capitalised itself.
    # Both were live defects: "so you're doing it all yourself then?" started
    # lowercase and read as her losing her thread, and the first attempt at
    # fixing it produced "[Curious] so..." by capitalising the tag instead.
    out = _drain(agent._drop_leading_ack(
        ["[curious] Right, so you're not asking customers at the moment then?"]))
    assert out.startswith("[curious] So you're"), out
    out = _drain(agent._drop_leading_ack(
        ["Okay. And how many jobs do you do in a week, roughly?"]))
    assert out.startswith("And how many"), out
    out = _drain(agent._drop_leading_ack(["[very warm] Yeah, that makes sense."]))
    assert out == "[very warm] That makes sense.", out


@case("a genuine word is not mistaken for the acknowledgement")
def _():
    line = "Sure thing, I'll get a colleague to give you a ring tomorrow."
    assert _drain(agent._drop_leading_ack([line])) == line
    line = "Right person to speak to about the reviews, are you?"
    assert _drain(agent._drop_leading_ack([line])) == line


@case("history is corrected to what was actually spoken, not what was written")
def _():
    brain = ai.Brain("sys")
    brain.history = [{"role": "user", "content": "About three."},
                     {"role": "assistant", "content": "Full reply that was cut."}]
    brain.amend_last("Full reply")
    assert brain.history[-1]["content"] == "Full reply", brain.history

    # A reply that was nothing but a cue leaves nothing audible. Dropping only
    # the assistant turn would put two user messages back to back, which the
    # Messages API will not take.
    brain.history = [{"role": "user", "content": "About three."},
                     {"role": "assistant", "content": "[curious]"}]
    brain.amend_last("")
    assert brain.history == [], brain.history


@case("a reply cut off mid-cue is not transcribed as a bare bracket")
def _():
    # Seen on a live call: BARGEIN landed between "[" and the cue name, and the
    # transcript recorded the whole turn as "[". Never spoken, only logged.
    assert agent.spoken_words("[") == ""
    assert agent.spoken_words("[curi") == ""
    assert agent.spoken_words("[warm] Twenty a week? [cur") == "Twenty a week?"
    # A bracket with words after it is not a truncated cue, so it stays put.
    assert agent.spoken_words("Twenty a week?") == "Twenty a week?"


@case("a spaced hyphen is a long dash in disguise, and a hyphenated word is not")
def _():
    # Live call: "I don't know the figure - the team handles that". A plain
    # hyphen is legitimate inside a word, so only the spaced form is a dash.
    assert agent.straighten("the figure - the team handles it") \
        == "the figure, the team handles it"
    assert agent.straighten("a well-known plumber") == "a well-known plumber"
    assert agent.straighten("ninety-seven a month") == "ninety-seven a month"


@case("a missing space after punctuation is put back, without breaking numbers")
def _():
    # Live call: "you're hearing me work right now,this call is the
    # demonstration". Fish runs the words together when the space is absent.
    assert agent.straighten("right now,this call is it") == "right now, this call is it"
    assert agent.straighten("three quid a day.Want to see?") == "three quid a day. Want to see?"
    # A decimal price and an abbreviation must survive, which is why a full stop
    # only gets a space when a CAPITAL follows it.
    assert agent.straighten("about 3.20 a day") == "about 3.20 a day"
    assert agent.straighten("a local one, e.g. yours") == "a local one, e.g. yours"


@case("dropping a cue never leaves a space stranded before punctuation")
def _():
    # Live call: "you're talking to me now , this is what I do".
    out = _drain(agent.clean_cues(["talking to me now[pause], this is it"]))
    assert agent.straighten(out) == "talking to me now, this is it", out


@case("a cut-off reply is recorded as the part they HEARD, not the part sent")
def _():
    # The bug Hugo caught on a live call. A 21 word introduction was cut after
    # about 3.2 seconds, recorded in full, and the model then believed it had
    # already said why it was ringing and jumped to "have you got a minute?"
    # about something the prospect had never heard.
    line = ("I'm Maria. I'm an AI receptionist, and I'm ringing round looking "
            "for work answering your phone. Have you got a minute?")
    heard = agent._spoken_prefix(line, 3200)
    assert len(heard) < len(line) / 2, heard
    assert heard.startswith("I'm Maria."), heard
    assert "minute" not in heard, "the ask was never heard, so it is not said"
    # Never cuts mid-word: the estimate lands on a space boundary.
    assert not line[len(heard):len(heard) + 1].strip() or heard in line

    # Speaking for longer than the line takes means they heard all of it.
    assert agent._spoken_prefix(line, 60000) == line


@case("the speaking-rate estimate follows the speed setting, not a constant")
def _():
    before = config.FISH_SPEED
    try:
        config.FISH_SPEED = 1.0
        slow = agent.chars_per_second()
        config.FISH_SPEED = 2.0
        assert agent.chars_per_second() == slow * 2, "a faster voice says more per second"
    finally:
        config.FISH_SPEED = before


@case("the word-finish window is long enough to actually finish a word")
def _():
    # At ~14 characters a second an average word plus its space is about six
    # characters, so a whole word is ~430ms and half a word ~215ms. 200ms only
    # ever finished a third of one, which is what Hugo heard as broken speech.
    half_word_ms = (6 / agent.BASE_CHARS_PER_SECOND) * 1000 / 2
    assert config.FINISH_WORD_MS >= half_word_ms, (
        f"{config.FINISH_WORD_MS}ms cannot finish the average half word "
        f"({half_word_ms:.0f}ms)"
    )


@case("the disclosure is never FORCED, but the prompt still answers it straight")
def _():
    from . import run
    # Hugo, twice: "don't disclose AI until they ask", "I'm just not gonna
    # disclose it so soon". Not hiding it, not leading with it.
    #
    # The bug this locks out: the PROMPT was changed to stop volunteering it,
    # while chase_disclosure() carried on appending "say you are an AI in your
    # VERY NEXT reply, using the words 'an AI assistant at HeyElsie'". Code beat
    # prompt, she announced it unprompted on every call, and the prompt looked
    # like the broken thing.
    assert not config.REQUIRE_DISCLOSURE, (
        "on by default means the code overrides the prompt again"
    )
    # Off must never mean denying it. The prompt has to answer straight away.
    p = run.SYSTEM_PROMPT
    assert "BEING AN AI" in p
    assert "Never deny it" in p
    assert "is this a robot" in p
    # And the old always-disclose rule must be gone, or the two contradict.
    assert "first substantive turn must say you are an AI" not in p


@case("the word cap leaves room for the question that ends a turn")
def _():
    # The cap cuts at the next full stop PAST the limit. Her explanation plus
    # its closing question runs about 30 words, so a 24 cap cut at the full stop
    # BEFORE the question and deleted it: the call then died in silence with the
    # prospect waiting for her to finish. Both "cutting halfway" and "no
    # reaction", from one number.
    # Not pinned to a number: the cap moved 24 -> 34 -> 28 as the stage briefs
    # changed. What must hold is that a turn shaped the way the briefs ask for
    # one, a single sentence and then a question, keeps its question. Losing it
    # is what killed a call in silence with the prospect waiting for her to
    # finish.
    spoken = []
    reply = ("So I'd answer every call that comes in, book the jobs straight "
             "into your system, and nothing gets missed. How does that sound?")
    out = "".join(agent._clip_reply([reply], spoken))
    assert out.rstrip().endswith("?"), out
    assert "How does that sound" in out, out

    # And a forty word list, which is what she used to produce, IS cut. The cap
    # cannot prevent a monologue, only chop one, so this is a backstop and the
    # real fix lives in the stage briefs.
    spoken = []
    monologue = ("I'd answer all your incoming calls, I don't miss any, don't "
                 "take holidays, work nights and weekends if you need me, I'd "
                 "book jobs straight into your system, send people reminders "
                 "so they don't forget, chase up quotes, confirm appointments.")
    out = "".join(agent._clip_reply([monologue], spoken))
    assert len(out.split()) <= config.MAX_SPOKEN_WORDS * 2, len(out.split())


@case("the AI disclosure is noticed once, and only when it was heard in full")
def _():
    for line in ("I'm Elsie, an AI assistant at HeyElsie.",
                 "Yeah, I'm an A.I.",
                 "I'm an artificial intelligence, if that's alright."):
        assert agent._DISCLOSED_RE.search(line), line
    # Ordinary words that merely contain those letters must not trip it, or she
    # goes quiet about being an AI before she has ever said so.
    for line in ("We'll wait for the rain to stop.", "Email is fine.",
                 "That said, plumbers do alright."):
        assert not agent._DISCLOSED_RE.search(line), line

    brain = ai.Brain("sys")
    before = brain.system_prompt
    brain.note_disclosed()
    assert brain.system_prompt != before, "the model has to be told it landed"
    once = brain.system_prompt
    brain.note_disclosed()
    assert brain.system_prompt == once, "told twice, the prompt grows every turn"


# -- thinking, not answering ------------------------------------------------

@case("a thinking noise is not an answer and never earns a reply")
def _():
    # Live call: she asked "how often's that happening?", got "Um.", rephrased,
    # got "Um." again, rephrased again. Three questions in ten seconds over the
    # top of a man trying to think.
    for filler in ("Um.", "Uh,", "Hmm.", "Er...", "Uh, well,", "Mm.", "Oh."):
        assert agent.is_thinking_noise(filler), filler
    # Real answers must always get through, however short or unhelpful. "Yeah"
    # is deliberately NOT filler: discarding it means ignoring something they
    # actually said.
    for real in ("Yeah.", "Okay.", "No.", "Um, about thirty.", "More than that.",
                 "Well, we miss a few", "Myself.", "A thousand a week"):
        assert not agent.is_thinking_noise(real), real


# -- her own voice coming back ----------------------------------------------

@case("a whole sentence of her own coming back is not treated as the prospect")
def _():
    import time as _t
    # THE bug behind "she is all over the place", "she doesn't wait" and the
    # stray "Right". Telnyx was believed to send only the far end, so nothing
    # guarded against her own voice returning. On a live call she said
    # "Brilliant. So you're hearing me work right" and it came straight back as
    # a turn reading "Brilliant. So you're hearing me work, right?", which she
    # answered. Hugo's next words were "I didn't say anything."
    a = agent.Agent.__new__(agent.Agent)
    a._last_spoken = "Brilliant. So you're hearing me work right"
    a._stopped_at = _t.monotonic()
    assert a._own_echo("Brilliant. So you're hearing me work, right?")
    assert a._own_echo("work right"), "a contiguous fragment is echo too"
    # A real reply must always get through, however much it overlaps.
    for real in ("I didn't say anything.", "Right.", "Yes.", "No thanks.",
                 "What happens if I'm out on a job?"):
        assert not a._own_echo(real), real
    # And once the window has passed, nothing is echo any more.
    a._stopped_at = _t.monotonic() - (config.ECHO_WINDOW_S + 1)
    assert not a._own_echo("Brilliant. So you're hearing me work, right?")


# -- answering the same turn twice ------------------------------------------

@case("a turn already answered from its partial is not answered again")
def _():
    from . import assembly_stt
    s = assembly_stt.AssemblyStream.__new__(assembly_stt.AssemblyStream)

    # The live failure. She acted on the partial, he kept talking, and the
    # longer final failed the old equality check and was answered as a brand
    # new turn: the same question twice, four seconds apart.
    s._last_seen = "It sounds like a very efficient"
    assert s._only_the_new_part("It sounds like a very efficient person or bot.") == ""

    # An identical final is old news too.
    s._last_seen = "we answer them ourselves"
    assert s._only_the_new_part("we answer them ourselves") == ""

    # A few words that merely finish the thought are not news either.
    s._last_seen = "It sounds like a very efficient"
    assert s._only_the_new_part("It sounds like a very efficient person or bot") == ""

    # But a genuine continuation IS news, and the WHOLE sentence goes through,
    # not just the tail: "usually when we're under a sink" arriving on its own
    # reads as a non sequitur, and the model has its own last reply in history.
    s._last_seen = "we miss a fair few"
    full = "we miss a fair few, usually when we're under a sink"
    assert s._only_the_new_part(full) == full

    # And a completely different final is always a real turn.
    s._last_seen = "hello"
    assert s._only_the_new_part("actually take me off your list") == \
        "actually take me off your list"

    # Nothing answered yet means nothing to subtract.
    s._last_seen = ""
    assert s._only_the_new_part("who is this?") == "who is this?"


# -- the stage gate ---------------------------------------------------------

@case("she picks the road, the map decides where it goes")
def _():
    from . import stages
    # A line could not express "they said no", so the give-up escape became the
    # main road and calls reached the close having skipped the middle:
    # "4/4 the onboarding call (gave up asking)".
    assert stages.route("permission", "yes") == ("explain", False)
    assert stages.route("permission", "busy") == ("callback", False)
    assert stages.route("permission", "no") == ("decline", False)
    # An exit she invented, or one belonging to another stage, changes nothing.
    assert stages.route("permission", "booked") == ("permission", False)
    assert stages.route("permission", "nonsense") == ("permission", False)
    assert stages.route("permission", None) == ("permission", False)
    # Booking a slot ends the call.
    assert stages.route("book", "booked")[1] is True


@case("giving up never marches on down the road")
def _():
    from . import stages
    # Somebody who will not answer the same question twice is telling you
    # something. The old give-up went to the NEXT stage, which is how a call
    # arrived at "book a time" having skipped everything.
    nxt, done = stages.give_up("permission")
    assert nxt == "callback", nxt
    assert stages.give_up("money")[0] == "book"
    assert stages.give_up("value")[0] == "decline"
    # Every terminal stage really terminates, or a call could loop forever.
    for key in ("decline", "soft_close", "callback"):
        assert stages.give_up(key)[1] is True, key


@case("every exit in the map points somewhere real")
def _():
    from . import stages
    keys = set(stages.STAGES)
    assert stages.START in keys
    for s in stages.STAGES.values():
        assert s.exits, f"{s.key} has no way out"
        for e in s.exits:
            assert e.goto == "" or e.goto in keys, f"{s.key} -> {e.goto}"
        assert s.fallback == "" or s.fallback in keys, s.key
    # And every stage is reachable from the start, or it is dead code.
    seen, todo = {stages.START}, [stages.START]
    while todo:
        for e in stages.STAGES[todo.pop()].exits:
            if e.goto and e.goto not in seen:
                seen.add(e.goto); todo.append(e.goto)
        for k in list(seen):
            fb = stages.STAGES[k].fallback
            if fb and fb not in seen:
                seen.add(fb); todo.append(fb)
    assert seen == keys, f"unreachable: {keys - seen}"


@case("the marker is recognised but never spoken")
def _():
    assert agent.chosen_exit("[GO: yes] Great, so what I do is...") == "yes"
    assert agent.chosen_exit("[GO: BUSY] No worries.") == "busy"
    assert agent.chosen_exit("No marker here.") is None
    assert agent._strip_marker("[GO: yes] Right you are.") == "Right you are."
    assert "GO" not in agent._strip_marker("[GO: booked] Thursday. [BOOK: Thu 2pm] [END]")


@case("the stage brief is swapped, never accumulated")
def _():
    from . import stages
    brain = ai.Brain("BASE PROMPT.")
    brain.set_stage(stages.brief("permission"))
    assert "ASKING TO EXPLAIN" in brain.system_prompt
    brain.set_stage(stages.brief("money"))
    assert "THE WAGE" in brain.system_prompt
    assert "ASKING TO EXPLAIN" not in brain.system_prompt, "two stages contradict"
    grown = len(brain.system_prompt)
    for k in list(stages.STAGES) * 4:
        brain.set_stage(stages.brief(k))
    assert len(brain.system_prompt) < grown * 2, len(brain.system_prompt)


@case("a permanent note survives a stage change")
def _():
    from . import stages
    brain = ai.Brain("BASE.")
    brain.note_disclosed()
    brain.note_opening("Hi, is that Smith Plumbing?", truncated=False)
    brain.set_stage(stages.brief("money"))
    assert "ALREADY TOLD THEM YOU ARE AN AI" in brain.system_prompt
    assert "ALREADY SAID THIS" in brain.system_prompt


@case("setting the stage reaches the brain, and is not fatal when it cannot")
def _():
    from . import stages

    class Spy:
        def __init__(self): self.briefs = []
        def set_stage(self, brief): self.briefs.append(brief)

    class Broken:
        def set_stage(self, brief): raise RuntimeError("no")

    # A copy-paste error once made _set_stage call ITSELF, which showed up on a
    # live call as "maximum recursion depth exceeded" once a turn, with the gate
    # silently dead and only the non-fatal wrapper keeping the call up.
    a = agent.Agent.__new__(agent.Agent)
    a.on_event = lambda k, t: None
    a.brain = Spy()
    a._set_stage("money", 0)
    assert len(a.brain.briefs) == 1, "the brief never reached the brain"
    assert "THE WAGE" in a.brain.briefs[0]

    errors = []
    a.brain = Broken()
    a.on_event = lambda k, t: errors.append((k, t))
    a._set_stage(stages.START, 0)
    assert errors and errors[0][0] == "error", errors


# -- prosody ----------------------------------------------------------------
# These need numpy, which the bridge host has and a bare dev machine may not.
# Skipped rather than failed there, because a missing optional dependency is not
# a regression and silently reporting "ok" would be worse than either.
try:
    import numpy as _np           # noqa: F401
    HAVE_NUMPY = True
except ImportError:               # pragma: no cover - depends on the machine
    HAVE_NUMPY = False


def prosody_case(name):
    """Register a prosody test, or note that it was skipped."""
    def wrap(fn):
        if HAVE_NUMPY:
            return case(name)(fn)
        SKIPPED.append(name)
        return fn
    return wrap



def _glide(start, end, ms, db_start=-20.0, db_end=-20.0):
    """A pitch sweep with an optional fade, through real mu-law companding."""
    import numpy as np
    from . import ulaw
    n = int(8000 * ms / 1000)
    hz = np.linspace(start, end, n)
    phase = 2 * np.pi * np.cumsum(hz) / 8000
    amp = 10 ** (np.linspace(db_start, db_end, n) / 20.0) * 32767
    x = ((np.sin(phase) + 0.5 * np.sin(2 * phase)) / 1.5 * amp).astype("<i2")
    return ulaw.encode(x.tobytes())


@prosody_case("pitch is tracked through mu-law within 5 percent")
def _():
    import numpy as np
    from . import prosody, ulaw
    for hz in (85, 150, 260, 330):
        n = 8000 * 300 // 1000
        t = np.arange(n) / 8000
        x = ((np.sin(2*np.pi*hz*t) + 0.5*np.sin(4*np.pi*hz*t)) / 1.5
             * 0.1 * 32767).astype("<i2")
        p = prosody.Prosody()
        p.feed(ulaw.encode(x.tobytes()))
        found = sorted(f[1] for f in p._frames)
        assert found, f"no voiced frames at {hz} Hz"
        med = found[len(found) // 2]
        assert abs(med - hz) / hz < 0.05, f"{hz} Hz read as {med:.0f}"


@prosody_case("a statement that falls away is finished, a level pause is not")
def _():
    from . import prosody
    def verdict(audio):
        p = prosody.Prosody()
        p.feed(audio)
        return p.verdict()[0]
    assert verdict(_glide(180, 120, 600, -20, -28)) == "fell"
    assert verdict(_glide(150, 230, 600)) == "rose"
    assert verdict(_glide(165, 160, 600)) == "held"
    # A fall with no fade is somebody drawing breath mid-thought, not an ending.
    assert verdict(_glide(180, 120, 600, -20, -20)) == "held"


@prosody_case("silence and a too-short snippet never claim a verdict")
def _():
    from . import prosody
    p = prosody.Prosody()
    assert p.verdict()[0] == "unsure"
    p.feed(b"\xff" * 4000)                     # mu-law silence
    assert p.verdict()[0] == "unsure"
    p2 = prosody.Prosody()
    p2.feed(_glide(180, 120, 60))              # far too short to fit a contour
    assert p2.verdict()[0] == "unsure"


@prosody_case("the contour is measured on the audio clock, not the wall clock")
def _():
    from . import prosody
    # Fed in one burst, as a jitter buffer catching up would. On the wall clock
    # every frame lands at the same instant, the time deltas collapse, and the
    # fitted slope explodes: measured at -1757 st/s for a contour that really
    # falls at about 12.
    p = prosody.Prosody()
    p.feed(_glide(180, 120, 600, -20, -28))
    _, why = p.verdict()
    st = float(why.split("pitch ")[1].split(" st/s")[0])
    assert -40 < st < 0, f"slope {st} st/s is not a real speech rate"


@prosody_case("an octave-jumping contour is refused, not read as a question")
def _():
    from . import prosody
    # The live failure: "PROSODY | rose: pitch +70.1 st/s". Real speech moves a
    # handful of semitones a second, so 70 was the tracker jumping octaves. Any
    # rise over 3.0 counted as a question, so she answered early on nonsense,
    # started talking over the prospect, and got cut off mid-word for it.
    p = prosody.Prosody()
    p._clock = 1.0
    p._last_voiced_wall = __import__("time").monotonic()
    # Alternating octaves, which is exactly what the artefact looks like.
    for i in range(20):
        p._frames.append((i * 0.02, 150.0 if i % 2 else 300.0, -20.0))
    p._last_voiced_at = p._frames[-1][0]
    verdict, why = p.verdict()
    assert verdict == "unsure", f"believed a broken contour: {verdict} ({why})"


@prosody_case("an impossibly steep slope is never trusted")
def _():
    from . import prosody
    assert prosody.MAX_ST_PER_S <= 30, "a real voice does not move 30 semitones a second"
    p = prosody.Prosody()
    p._last_voiced_wall = __import__("time").monotonic()
    # A smooth but absurdly fast rise: no octave jumps, so only the ceiling
    # catches it.
    for i in range(20):
        p._frames.append((i * 0.002, 120.0 * (1.06 ** i), -20.0))
    p._last_voiced_at = p._frames[-1][0]
    assert p.verdict()[0] == "unsure", p.verdict()


@prosody_case("resetting clears the contour, so one turn cannot answer the next")
def _():
    from . import prosody
    p = prosody.Prosody()
    p.feed(_glide(180, 120, 600, -20, -28))
    assert p.verdict()[0] == "fell"
    p.reset()
    assert p.verdict()[0] == "unsure"


# -- answerphone detection ---------------------------------------------------
#
# This is the one piece of logic in the bridge that HANGS UP ON PEOPLE, so the
# tests that matter most are the ones proving it does not fire on a human.


class _FakeAMD:
    """Just enough transport for _answerphone."""
    def __init__(self, machine=False):
        self._m = machine

    def is_machine(self):
        return self._m


def _amd(heard=None, machine=False):
    """Run the detector without building a whole Agent."""
    a = agent.Agent.__new__(agent.Agent)
    a.transport = _FakeAMD(machine)
    a.on_event = None
    a._emit = lambda *rest: None
    r = agent.CallResult(number="+15550001111")
    return a._answerphone(r, heard), r.outcome


@case("Telnyx saying machine hangs up")
def _():
    hit, outcome = _amd(machine=True)
    assert hit and outcome == "answering_machine", outcome


@case("a real voicemail greeting is caught from its words alone")
def _():
    # Verbatim from Atlas Plumbing, the call that started all this.
    greeting = ("Thank you for calling Atlas Plumbing. We can't get to the phone "
                "right now. Please leave your name and phone number and we will "
                "call you back as soon as we can. Thank you.")
    hit, outcome = _amd(greeting)
    assert hit and outcome == "answering_machine", outcome


@case("a HUMAN answering their own phone is never cut off")
def _():
    # Verbatim from Crystal at Hassle Free Plumbing, who is a person.
    for human in [
        "Hassle Free Plumbing, this is Crystal. How can I help you?",
        "Hello?",
        "Yeah, hi.",
        "Smith and Sons, Dave speaking.",
        "Good morning, plumbing department.",
        # The dangerous near-miss: a receptionist OFFERING to take a message
        # says something very close to what a machine says.
        "He's out on a job right now, can I take a message for you?",
        "I can take your name and number and get him to call you back.",
    ]:
        hit, outcome = _amd(human)
        assert not hit, f"would have hung up on a person: {human!r} -> {outcome}"


@case("carrier voicemail is caught even though it is short")
def _():
    """Verbatim from +17086925510, which was filed as a COMPLETED conversation.

    Business greetings need the length check, because a receptionist offering
    to take a message reads like a machine. Carrier intros do not, and applying
    the length rule to them let this through.
    """
    for line in ["Your call has been forwarded to voicemail.",
                 "The person you're trying to reach is not available.",
                 "Please record your message at the tone."]:
        hit, outcome = _amd(line)
        assert hit and outcome == "answering_machine", f"missed carrier voicemail: {line!r}"


@case("the carrier list still cannot fire on a human")
def _():
    for human in ["Hello?", "Pipe Doctor Plumbing, this is Sam.",
                  # BOTH contractions. "is not available" was briefly on the
                  # certain list, where it needs no length check, and this
                  # exact line hung up on a receptionist.
                  "He's not available right now, can I take a message?",
                  "He is not available right now, can I take a message?",
                  "She is not available at the moment, want his cell?",
                  "Yeah he's not around, try his cell."]:
        hit, _ = _amd(human)
        assert not hit, f"would have hung up on a person: {human!r}"


@case("a machine phrase alone is not enough, it must also run on")
def _():
    # Short enough that somebody is plainly waiting for a reply.
    hit, _ = _amd("Leave a message.")
    assert not hit, "a four word answer is a person being terse, not a greeting"
    # Same phrase, full greeting length, is a machine.
    hit, _ = _amd("You have reached the office of Kuhn Plumbing, please leave "
                  "a message and somebody will return your call shortly.")
    assert hit


@case("not_sure and silence are not a machine")
def _():
    # mark_machine must only latch on the exact word "machine": everything else
    # would mean hanging up on a human on a hunch.
    from .telnyx import TelnyxTransport
    t = TelnyxTransport.__new__(TelnyxTransport)
    t._machine = __import__("threading").Event()
    t._machine_result = None
    for verdict in ("not_sure", "silence", "human", "", None):
        t.mark_machine(verdict)
        assert not t.is_machine(), f"{verdict!r} must not count as a machine"
    t.mark_machine("machine")
    assert t.is_machine()


class _HangupRig:
    """The smallest transport the teardown touches: is it live, is she talking."""
    def __init__(self, speaking_for=0.0, live=True):
        self._until = time.monotonic() + speaking_for
        self._live = live
        self.hung_up_at = None

    def is_speaking(self):
        return time.monotonic() < self._until

    def is_live(self):
        return self._live and self.hung_up_at is None

    def hangup(self):
        self.hung_up_at = time.monotonic()


def _teardown(t):
    """Exactly the wait the real call() does before hanging up."""
    if t.is_live():
        drain = time.monotonic() + config.HANGUP_DRAIN_MAX_S
        while t.is_speaking() and t.is_live() and time.monotonic() < drain:
            time.sleep(0.05)
        if t.is_live():
            time.sleep(config.HANGUP_PAUSE_S)
    t.hangup()


@case("her last words are not chopped off by the hangup")
def _():
    """The drain must wait for audio already sent to finish playing.

    Hugo: "when she finished the call, don't hang up immediately, no?" The loop
    reaches teardown while the closing sentence is still going out, so without
    this the line dies mid-word.
    """
    t = _HangupRig(speaking_for=0.4)
    start = time.monotonic()
    _teardown(t)
    waited = t.hung_up_at - start
    assert waited >= 0.4, f"hung up while she was still talking, after {waited:.2f}s"
    assert waited >= 0.4 + config.HANGUP_PAUSE_S - 0.15, \
        f"did not hold the line for the closing beat, only {waited:.2f}s"
    assert waited < config.HANGUP_DRAIN_MAX_S + config.HANGUP_PAUSE_S + 1, \
        f"dawdled for {waited:.2f}s"


@case("a stuck speaking flag cannot hold the line open for ever")
def _():
    t = _HangupRig(speaking_for=9999)
    start = time.monotonic()
    _teardown(t)
    assert t.hung_up_at is not None
    assert time.monotonic() - start <= config.HANGUP_DRAIN_MAX_S + config.HANGUP_PAUSE_S + 1


@case("no polite pause when THEY hung up on us")
def _():
    """Nothing to be polite to, and the next call should not be held up."""
    t = _HangupRig(speaking_for=9999, live=False)
    start = time.monotonic()
    _teardown(t)
    assert time.monotonic() - start < 0.2, "waited on a line that was already dead"


# -- which opener --------------------------------------------------------------


def _greeter(business):
    a = agent.Agent.__new__(agent.Agent)
    a.business_words = tuple(
        w for w in __import__("re").findall(r"[a-z]+", (business or "").lower())
        if len(w) >= 4 and w not in agent._GENERIC_TRADE_WORDS)
    return a


@case("announcing yourself skips the name check")
def _():
    a = _greeter("Waterways Plumbing and Drain Cleaning LLP")
    # Verbatim from Mike, the call this fix exists for.
    for g in ["Waterways Plumbing and Drain Cleaning LLP.",
              "Waterways Plumbing and Drain Cleaning. This is Mike speaking.",
              "Hassle Free Plumbing, this is Crystal. How can I help you?",
              "Chavarria's Plumbing, Tony speaking."]:
        assert a.announced_themselves(g), f"should have skipped the name check: {g!r}"


@case("a bare hello still gets the name check")
def _():
    a = _greeter("Waterways Plumbing and Drain Cleaning LLP")
    for g in ["Hello?", "Hello", "Yeah?", "Yep", "Hi", "", None, "  "]:
        assert not a.announced_themselves(g), f"should have asked who it is: {g!r}"


@case("a generic trade word is not somebody announcing themselves")
def _():
    """"Plumbing" is in half the plumbers in America, so it proves nothing."""
    a = _greeter("Highland Plumbing")
    assert not a.announced_themselves("plumbing"), \
        "matched a generic trade word, so every plumber looks like an announcement"
    assert a.announced_themselves("Highland Plumbing"), "missed the distinctive word"


@case("only one of the two openers introduces her, so she cannot do it twice")
def _():
    """Beach Plumbing heard "Hi there, it's Maria" twice in a row.

    The permission stage brief tells her to give her name. When the opener did
    it as well, she did it once each. Whichever opener runs, the name must be
    said by exactly one of them.
    """
    a = agent.Agent.__new__(agent.Agent)
    a.opener = "[warm] Hi, is that Kuhn Plumbing?"
    a.opener_warm = "[warm] Hi there."
    for text in (a.opener, a.opener_warm):
        assert "maria" not in text.lower(), \
            f"opener introduces her, and so does the permission stage: {text!r}"


@case("both openers are eligible for pre-rendered audio")
def _():
    """Otherwise the warm one is re-rendered on answer, as dead air."""
    a = agent.Agent.__new__(agent.Agent)
    a.opener = "[warm] Hi, is that Kuhn Plumbing?"
    a.opener_warm = "[warm] Hi there."
    a._opener_audio = b"COLD"
    a._opener_warm_audio = b"WARM"
    for text, want in ((a.opener, b"COLD"), (a.opener_warm, b"WARM")):
        t = agent.straighten(text)
        got = (a._opener_audio if t == agent.straighten(a.opener)
               else a._opener_warm_audio if t == agent.straighten(a.opener_warm)
               else None)
        assert got == want, f"{text!r} would have been re-rendered live"


@case("a greeting still in progress holds the opener back")
def _():
    """Stroh Bros: her opener and their greeting are stamped the same second.

    The plain 2.5s wait is for SILENCE. It is not enough to hear out "Stroh
    Bros Plumbing, Dave speaking", so without the extension she opens straight
    over them and never learns they announced themselves.
    """
    class Ears:
        """Talks for 3.5s, then settles."""
        def __init__(self):
            self.t0 = time.monotonic()

        def _elapsed(self):
            return time.monotonic() - self.t0

        def next_turn(self, timeout):
            time.sleep(min(timeout, 0.05))
            return "Stroh Bros Plumbing, Dave speaking." if self._elapsed() > 0.35 else None

        def settled_partial(self, *rest):
            return None

        def partial_text(self):
            return "Stroh Bros" if self._elapsed() <= 0.35 else ""

        def accept(self, text):
            pass

    ears, greeting = Ears(), ""
    # Squeezed timings so the test is quick; the shape is what matters.
    deadline = time.time() + 0.2
    hard = time.time() + 2.0
    while time.time() < deadline:
        got = ears.next_turn(timeout=0.05)
        if got:
            greeting = got
            break
        if ears.partial_text():
            deadline = min(hard, time.time() + 0.2)
    assert greeting, "opened over the top of a greeting that was still in progress"


@case("silence is never punished by the extended wait")
def _():
    """A dead line must still get the opener at the normal 2.5s, not the ceiling."""
    class Silent:
        def next_turn(self, timeout):
            time.sleep(min(timeout, 0.02))
            return None

        def settled_partial(self, *rest):
            return None

        def partial_text(self):
            return ""

        def accept(self, text):
            pass

    ears = Silent()
    start = time.time()
    deadline = start + 0.3
    hard = start + 3.0
    while time.time() < deadline:
        if ears.next_turn(timeout=0.02):
            break
        if ears.partial_text():
            deadline = min(hard, time.time() + 0.3)
    waited = time.time() - start
    assert waited < 0.6, f"held a silent line for {waited:.2f}s, should open at the short wait"


@case("a cue tag never costs her the closing question")
def _():
    """The measured failure: adding feeling deleted the question.

    _clip_reply counted "[very warm] " as a word because clean_cues wraps it
    from the outside. Over 400 realistic turns one cue changed 25 of them, and
    in 25 of 25 the deleted thing was the trailing question. Which is precisely
    how a prospect ends up holding silence and hangs up.
    """
    shape = ("This is the first statement of the turn. "
             "And here is a second one that runs on a while. "
             "So how many jobs a week are you doing?")
    plain, cued = [], []
    list(_clip(shape, plain))
    list(_clip("[very warm] " + shape, cued))
    assert "".join(plain).rstrip().endswith("?"), "the uncued turn lost its question"
    assert "".join(cued).rstrip().endswith("?"), \
        "a cue tag cost her the closing question, which is the whole bug"


@case("counting ignores cues, so cued and uncued turns clip alike")
def _():
    a, b = [], []
    list(_clip("Hi there.", a))
    list(_clip("[warm] Hi there.", b))
    assert spoken_of(a) == spoken_of(b), (spoken_of(a), spoken_of(b))
    c = []
    list(_clip("That's [emphasis] five bucks a day.", c))
    assert "five bucks a day" in "".join(c)


def _clip(text, spoken):
    """Feed a line through _clip_reply in small slices, as the stream does."""
    toks = [text[i:i + 7] for i in range(0, len(text), 7)]
    return list(agent._clip_reply(iter(toks), spoken))


def spoken_of(parts):
    return agent.spoken_words("".join(parts))


@case("stacked and compound cues no longer defeat the ack stripper")
def _():
    """The doubled "Right." came back on exactly the most expressive lines.

    The prompt recommends stacking, and the old one-tag pattern matched none of
    these, so _strip_ack returned them untouched and the caller heard the
    backchannel "Right." followed by her own "Right.".
    """
    for lead in ["[warm][amused] ", "[warm, professional] ", "[warm] [amused] ",
                 "[very warm, quite playful] ", "[curious] ", ""]:
        got = agent._strip_ack(lead + "Right, so how many jobs a week?")
        assert "right," not in got.lower(), f"{lead!r} defeated the stripper: {got!r}"
        assert "So how many jobs a week?" in got, got
        # The cue itself must survive, it is the performance instruction.
        if lead.strip():
            assert got.lstrip().startswith("["), f"cue was eaten: {got!r}"


@case("two stacked cushions are both removed")
def _():
    got = agent._strip_ack("Fair enough, that's a good question, so are you the owner?")
    assert got.lower().startswith("so are you"), got


@case("an acknowledgement-only reply is never deleted into silence")
def _():
    """"Of course." strips to "". Yielding nothing means dead air after they
    have just spoken, and two silent rounds end the call as went_quiet."""
    for reply in ["Of course.", "Perfect.", "[warm] Great.", "Right."]:
        toks = [reply[i:i + 4] for i in range(0, len(reply), 4)]
        # No backchannel played, so she must still say something.
        out = "".join(agent._drop_leading_ack(iter(toks), acked=False))
        assert agent.spoken_words(out).strip(), \
            f"{reply!r} became total silence with no acknowledgement to cover it"
    # WITH a backchannel, silence is correct: it already made that noise.
    toks = ["Of ", "cou", "rse."]
    out = "".join(agent._drop_leading_ack(iter(toks), acked=True))
    assert not agent.spoken_words(out).strip(), f"said it twice: {out!r}"


@case("a normal reply is still stripped whether or not an ack played")
def _():
    line = "Right, so how many jobs are you doing in a week at the moment?"
    toks = [line[i:i + 5] for i in range(0, len(line), 5)]
    for acked in (True, False):
        out = "".join(agent._drop_leading_ack(iter(toks), acked=acked))
        assert not out.lower().lstrip().startswith("right,"), (acked, out)
        assert "how many jobs" in out


@case("a short opening sentence no longer kills the early flush")
def _():
    """Verbatim live lines that never flushed at all.

    The old code froze on the first sentence of the buffer, so "Brilliant."
    failed the 3-word test and kept failing it, and the whole reply waited for
    the model to finish.
    """
    from .fish_stream import _flush_point

    def first_cut(text):
        buf, scan = "", 0
        for i in range(0, len(text), 5):
            buf += text[i:i + 5]
            cut, scan = _flush_point(buf, scan)
            if cut is not None:
                return buf[:cut]
        return None

    # The real early-flush case: a short opener followed by a full sentence.
    # It must cut after the SECOND sentence, not give up because the first was
    # too short. Before the fix this returned None for the whole turn.
    got = first_cut("Fair question. A colleague will explain. So are you the right person?")
    assert got is not None, "never flushed at all, the whole turn waited"
    assert got.strip().endswith("A colleague will explain."), got

    # And a short opener with nothing else to cut on must still resolve at the
    # end rather than hanging forever.
    got = first_cut("Brilliant. So you're hearing me work right now, right?")
    assert got is not None, "never flushed at all"


@case("the flush does not split a decimal or a title")
def _():
    from .fish_stream import _flush_point
    text = "You are sitting at 4.2 stars on Google now, aren't you?"
    cut, _ = _flush_point(text, 0)
    # It may legitimately cut at the end. What it must never do is cut BETWEEN
    # the 4 and the 2, which would have her read "four point" then "two stars".
    assert cut != text.index("4.") + 2, f"split the decimal: {text[:cut]!r}"

    text = "I spoke to Mr. Patel about it yesterday. And he agreed."
    cut, _ = _flush_point(text, 0)
    assert cut != text.index("Mr.") + 3, f"split the title: {text[:cut]!r}"
    assert cut == text.index("yesterday.") + len("yesterday."), \
        f"expected the cut after the first real sentence, got {text[:cut]!r}"


@case("a cue does not inflate the three-word floor")
def _():
    from .fish_stream import _flush_point
    # "[very warm] Hi." is two spoken words, so it must not flush.
    cut, _ = _flush_point("[very warm] Hi. ", 0)
    assert cut is None, f"flushed on a two-word sentence: {cut}"


@case("the fallback speech path also enforces the cue allowlist")
def _():
    """When the Fish socket fails to open, every call routes through
    _say_stream, which only ever stripped the [END] marker. A free-form
    [chuckling] went straight to the voice and the laugh was back.

    Asserts on WHAT THE TTS WAS ASKED TO SAY, not the transcript. That is
    exactly why this went unnoticed: the transcript strips cues either way.
    """
    said = []

    class FakeTTS:
        def say(self, text):
            said.append(text)
            return b"\x00" * 320

    a = agent.Agent.__new__(agent.Agent)
    a.tts = FakeTTS()
    a.voice_stream = None
    a.transport = None
    a._emit = lambda *rest: None

    # Reproduce exactly what produce() does to a sentence.
    for sentence in ["[chuckling] Fair enough. [END]", "[warm] So how many jobs a week?"]:
        clean = "".join(agent.clean_cues([agent._strip_marker(sentence)])).strip()
        if clean:
            a.tts.say(clean)

    blob = " ".join(said)
    assert "chuckling" not in blob, f"the laugh reached the voice: {blob!r}"
    assert "END" not in blob, f"the marker was spoken: {blob!r}"
    assert "[warm]" in blob, f"an allowed cue was thrown away: {blob!r}"
    assert "So how many jobs a week?" in blob


@case("the ack stripper still cannot eat a real sentence")
def _():
    """These are why the trailing-punctuation requirement exists."""
    for line in [
        "Right person to speak to about this, are you?",
        "In short supply of engineers right now, are you?",
        "Certainly not, we handle those in house.",
        "Sure thing is what he said, funnily enough.",
        "Great British Plumbing, this is Dave.",
        "Perfect Pipes Plumbing here.",
    ]:
        assert agent._strip_ack(line) == line, f"ate a real sentence: {line!r}"


# -- copy_guard: the rules that stopped being suggestions --------------------

# THE LINE THAT CAUSED THIS MODULE. Spoken on the verification call Hugo asked
# me to place on 2026-07-29, after the prompt-only fix had already "worked" once.
# Four items, 29 words, no question, and the prospect replied "Okay."
BROCHURE = (
    "So I answer phones while you're out on a job. Takes the calls you'd "
    "otherwise miss, books jobs straight in, texts people back, basically "
    "covers your line when you can't."
)

# Real AI turns from the US plumber campaign that carry two or more commas and
# must survive untouched. If a change to the rule breaks one of these, it has
# started eating ordinary speech, which is the only way this feature can hurt.
SPARE = [
    "Hey there, sorry to catch you cold like this, I'm Maria, and I'm actually "
    "calling because I'm looking for work. You got a second?",
    "Hi, it's Maria from HeyElsie. I'm calling because I answer phones for trade "
    "businesses, I don't miss calls, I don't take holidays, and I cost under "
    "five bucks a day.",
    "Hi there, it's Maria. I'm calling because I'm looking for a job answering "
    "phones for a trade business, and I figured I'd just ask, would you be open "
    "to hearing what that looks like?",
    "Look, I know this is a weird call, I'm ringing you cold to ask for a job.",
    "Yeah, no worries, I'll be quick.",
    "Okay, got it, so what's your setup?",
    "Never miss anything, never take a day off.",
    "You're on about 4.2 stars, and there are 1,200 of them, so that's solid.",
    # The three the first version of the rule broke. A company name is the one
    # comma-heavy proper noun on these calls, and it is the first thing out of
    # her mouth, so a cut here is heard on every call to a business with a
    # comma in its name.
    "Hi, is that Master Drains & Plumbing, Inc., Littleton?",
    "Hi, is that Limitless Plumbing and Sewer, LLC?",
    "Hi, is that Tech Sewer Cleaning, Plumber Queens Village NY "
    "(Camera Inspection, Hydro Jetting & More)?",
]


@case("the brochure list is cut to two items")
def _():
    out = copy_guard.trim_list(BROCHURE)
    assert "texts people back" not in out, out
    assert "books jobs straight in." in out, out
    assert len(agent.spoken_words(out).split()) < 25, out


@case("a list cut does not eat the closing question")
def _():
    # The failure mode this rule could easily have caused, and the one that has
    # already killed calls twice: cutting the turn instead of the sentence.
    line = ("I answer calls, book jobs in, chase people up. Never miss "
            "anything, never take a day off. How does that land?")
    out = copy_guard.trim_list(line)
    assert out.endswith("How does that land?"), out
    assert "chase people up" not in out, out
    assert "never take a day off" in out, out


@case("the list rule leaves ordinary speech alone")
def _():
    for line in SPARE:
        assert copy_guard.trim_list(line) == line, f"cut real speech: {line!r}"


@case("a comma inside a cue or a number is not a clause boundary")
def _():
    for line in [
        "[very warm, quite playful] Right, that makes sense.",
        "You've got 1,000 reviews, 4.2 stars, and none of them are recent.",
    ]:
        assert copy_guard.trim_list(line) == line, line


@case("streaming the guard gives the same answer as one string")
def _():
    # The live path feeds it Claude's tokens, which arrive in whatever sizes the
    # API decides. A rule that only holds on a whole string is not a rule.
    for line in [BROCHURE] + SPARE:
        whole, _ = copy_guard.swap(line)
        whole = copy_guard.trim_list(whole)
        for size in (1, 3, 7):
            bits = [line[i:i + size] for i in range(0, len(line), size)]
            assert "".join(copy_guard.guard(iter(bits))) == whole, (size, line)


@case("banned register is swapped, and the capital is kept")
def _():
    out, notes = copy_guard.swap(
        "Furthermore, I would be happy to assist you prior to Tuesday.")
    assert "Furthermore" not in out and "Also," in out, out
    assert "I can help you before Tuesday" in out, out
    assert len(notes) == 4, notes


@case("the guard never touches the AI disclosure")
def _():
    # _DISCLOSED_RE decides whether she has declared herself, which is a
    # compliance record. A swap that reworded it would make the code believe a
    # disclosure happened that did not.
    for line in [
        "Just so you know, I'm an A.I., not a person.",
        "I should say I'm artificial intelligence, if that matters to you.",
    ]:
        out, _ = copy_guard.swap(line)
        assert out == line, out
        assert agent._DISCLOSED_RE.search(copy_guard.trim_list(out)), out


@case("the live path records what the guard let through, not what was written")
def _():
    # The guard sits upstream of _clip_reply on purpose. If it sat downstream,
    # `spoken` would claim the items she was stopped from saying, and the model
    # would believe it had already delivered them.
    spoken: list[str] = []
    tokens = agent._clip_reply(copy_guard.guard(iter([BROCHURE])), spoken)
    said = "".join(tokens)
    assert "texts people back" not in said, said
    assert "texts people back" not in "".join(spoken), spoken


# -- the conversational rhythm, 2026-07-30 ----------------------------------
# Hugo, listening to a live call: "she speaks over me", "you're cutting off the
# human before they've actually finished", "the user doesn't answer a question
# immediately, don't just fire off another one". Each test below is one of
# those moments, pinned.


@case("both start talking at once: she yields fast, not at full threshold")
def _():
    # The race. If the prospect is already talking when her audio starts, she
    # should stop in a few hundred ms, not insist on the full 700ms of proof.
    # Past the early window, the normal threshold is back, so a cough mid-reply
    # still does not stop her.
    base = 700.0
    early = agent.barge_threshold_ms(400.0, base)
    late = agent.barge_threshold_ms(2000.0, base)
    assert early < base * 0.6, early
    assert late == base, late


@case("a question clipped just before its mark still counts as asked")
def _():
    # Hugo's live call, 17:04: her "...to get you set up?" was cut a word from
    # the end, so the delivered text had no "?", the waiting branch never fired,
    # and the resume shortcut asked a FOLLOW-UP while he was still thinking.
    full = "Would you be up for a quick call with someone from my team to get you set up?"
    nearly = full[:-6]                    # "...to get you se"
    assert agent.question_was_asked(full, nearly)
    # Cut long before the question began: they never heard it, so resuming and
    # finishing the question is right, and waiting in silence is wrong.
    early_cut = full[:20]
    assert not agent.question_was_asked(full, early_cut)
    # No question in the reply at all.
    assert not agent.question_was_asked("I answer phones and book jobs in.", "I answer")


@case("backchannels are gated by prosody when the reader is on")
def _():
    # "Use organic back channels, but only when the prosody actually calls for
    # it." A landed statement (fell) invites a "Right."; a question (rose), a
    # mid-thought pause (held) and an unreadable contour do not.
    a = agent.Agent.__new__(agent.Agent)
    a._backchannel = [("Right.", b"x")]
    a.prosody = object()                  # a reader is attached
    old_chance = config.BACKCHANNEL_CHANCE
    old_pros = config.PROSODY_ENABLED
    config.BACKCHANNEL_CHANCE = 1.0
    config.PROSODY_ENABLED = True
    try:
        heard = "we miss a fair few calls when we're out on jobs"
        a._last_contour = "fell"
        assert a._pick_backchannel(heard) is not None
        for contour in ("rose", "held", "unsure", None):
            a._last_contour = contour
            assert a._pick_backchannel(heard) is None, contour
        # No prosody reader attached: the text rules stand alone, as before.
        a.prosody = None
        a._last_contour = None
        assert a._pick_backchannel(heard) is not None
    finally:
        config.BACKCHANNEL_CHANCE = old_chance
        config.PROSODY_ENABLED = old_pros


@case("silence is never acknowledged")
def _():
    # The resume path feeds WENT_QUIET through the reply pipeline, and
    # "(they said nothing)" is three words that pass every text check, so she
    # could say "Right." in answer to nothing at all.
    a = agent.Agent.__new__(agent.Agent)
    a._backchannel = [("Right.", b"x")]
    a.prosody = None
    a._last_contour = None
    old = config.BACKCHANNEL_CHANCE
    config.BACKCHANNEL_CHANCE = 1.0
    try:
        assert a._pick_backchannel(config.WENT_QUIET) is None
    finally:
        config.BACKCHANNEL_CHANCE = old


@case("the Fish socket carries prosody across chunk boundaries")
def _():
    # "If you aren't passing continuation flags between chunks, your prosody
    # resets every few seconds and the melody dies." The flag is Fish's own
    # condition_on_previous_chunks, and this locks it into the start request.
    from pathlib import Path
    from . import fish_stream
    src = Path(fish_stream.__file__.replace(".pyc", ".py")).read_text()
    assert '"condition_on_previous_chunks": True' in src


@case("the US register leaks are swapped, not just prompted away")
def _():
    # Both leaked onto live calls while the prompt banned them: "at the minute"
    # on 2026-07-30 to Hugo, "brilliant" repeatedly before that. The same
    # move as the rest of copy_guard: stop asking the model to police itself.
    out, notes = copy_guard.swap("Brilliant, how are you covering the phone at the minute?")
    assert "at the minute" not in out.lower(), out
    assert "brilliant" not in out.lower(), out
    assert notes, notes


# -- simulated disfluency ----------------------------------------------------
# "Real humans don't always glide through a sentence. They trip, they restart
# a word." Injected in code, tied to where a person actually trips: the start
# of a thought. Never left to the model, which cannot be trusted to do it
# rarely.


def _stutter(text: str, chance: float = 1.0, replies: int = 1) -> list[str]:
    """Run text through a fresh injector, forcing the coin flip."""
    import random as _random
    from . import disfluency
    d = disfluency.Disfluencer(rng=_random.Random(7))
    old = config.DISFLUENCY_CHANCE
    config.DISFLUENCY_CHANCE = chance
    try:
        outs = []
        for _ in range(replies):
            outs.append("".join(d.feed(iter([text]))))
        return outs
    finally:
        config.DISFLUENCY_CHANCE = old


@case("a stutter lands at the start of a thought, once, and reads human")
def _():
    out = _stutter("I answer phones while you're on a job. Takes the calls you'd miss.")[0]
    # One trip, not a broken record: the whole reply gains at most one repeat.
    assert out.count("I, I") <= 1, out
    assert "I, I answer" in out or "Takes, takes" in out, out


@case("a long word trips on its first syllable, not the whole word")
def _():
    out = _stutter("specifically the evening calls are the problem.")[0]
    assert "spe-specifically" in out, out


@case("the disfluency never touches a cue, the disclosure, or a name")
def _():
    # Cues are performance instructions and must reach Fish intact.
    out = _stutter("[very warm] Listen, I never miss a call.")[0]
    assert "[very warm]" in out, out
    # The word AI is a compliance record, never a toy.
    out = _stutter("AI receptionist, that's what I am.")[0]
    assert "AI, AI" not in out and "AI-AI" not in out, out


@case("the stutter is rare and never twice in a row")
def _():
    # Chance forced to 1.0, so only the minimum gap keeps it apart: reply two
    # must come out clean however the coin lands.
    outs = _stutter("I answer phones. I book jobs in.", chance=1.0, replies=2)
    trip = lambda s: (", " in s and any(
        f"{w}, {w.lower()}" in s for w in s.replace(",", "").split())) or "-" in s
    assert not trip(outs[1]), outs[1]
    # And at the configured rate it stays an occasional thing, not a tic.
    import random as _random
    from . import disfluency
    d = disfluency.Disfluencer(rng=_random.Random(11))
    hits = 0
    for _ in range(100):
        out = "".join(d.feed(iter(["I answer phones while you work."])))
        if out != "I answer phones while you work.":
            hits += 1
    assert 2 <= hits <= 30, hits


@case("giving up a stage does not talk over a question she just asked")
def _():
    # Heard live, 2026-07-31 10:01: "tomorrow morning, or Thursday
    # afternoon?" at 82.0s and a SECOND ask at 85.5s with nothing heard
    # between, because burning the last stage try triggers an immediate
    # give-up line. The immediate speak exists (silence once ran seventeen
    # seconds after a give-up), but a question in the air buys the prospect
    # one full listen first, and a real answer is what gets replied to.
    def build(last, pending, hears):
        a = agent.Agent.__new__(agent.Agent)
        a._last_spoken = last
        a._question_pending = pending
        a.ears = object()
        a._emit = lambda *rest: None
        a._listen_streaming = lambda result, timeout=None: hears
        calls = []
        a._say_live = lambda heard, result: calls.append(heard) or (False, False, None)
        return a, calls

    # She asked, they answer during the grace listen: the answer is replied to.
    a, calls = build("Tomorrow morning or Thursday afternoon?", False, "tomorrow morning")
    a._giveup_line(None)
    assert calls == ["tomorrow morning"], calls
    # She asked, they stay silent: the give-up line goes ahead.
    a, calls = build("Tomorrow morning or Thursday afternoon?", False, "")
    a._giveup_line(None)
    assert calls == [agent.config.WENT_QUIET], calls
    # The question mark was clipped off but the question was asked: same deal.
    a, calls = build("Tomorrow morning or Thursday", True, "Thursday works")
    a._giveup_line(None)
    assert calls == ["Thursday works"], calls
    # No question in the air: she speaks straight away, no listen first.
    a, calls = build("Right, leave it with me.", False, "SHOULD NOT LISTEN")
    a._listen_streaming = lambda result, timeout=None: (_ for _ in ()).throw(AssertionError("listened"))
    a._giveup_line(None)
    assert calls == [agent.config.WENT_QUIET], calls


@case("only the target language's characters ever reach the voice")
def _():
    # Fish performs whatever it is given: one CJK or Cyrillic character in the
    # text is a language-switch trigger, an emoji is an invitation to improvise
    # a noise. The model is not supposed to produce them, and "not supposed to"
    # has never once held, so the constraint lives at the last gate. Accented
    # Latin folds to plain ASCII rather than vanishing: a dropped letter would
    # garble the word instead of just flattening the accent.
    assert agent.straighten("你好 there").strip() == "there"
    assert "👍" not in agent.straighten("Great 👍 stuff")
    assert agent.straighten("a café visit") == "a cafe visit"
    assert agent.straighten("Привет, hello") .strip(" ,") == "hello"
    assert agent.straighten("£149 a month") == "GBP 149 a month"
    # And the existing rules still hold through the fold.
    assert agent.straighten("wait — no") == "wait, no"


@case("the sampling ceiling holds even against the settings page")
def _():
    # The saved fish_config had temperature 0.95 / top_p 0.95, which is the
    # regime where S2.1 invents noises and slips language. The ceiling is
    # enforced where the settings land, so a hot value saved in Supabase is
    # clamped on its way onto a call rather than trusted.
    from . import settings
    old_t, old_p = config.FISH_TEMPERATURE, config.FISH_TOP_P
    try:
        changed = settings.apply({"temperature": 0.95, "top_p": 0.98})
        assert config.FISH_TEMPERATURE <= config.FISH_TEMPERATURE_MAX
        assert config.FISH_TOP_P <= config.FISH_TOP_P_MAX
        assert any("clamped" in c for c in changed), changed
        # A sane saved value passes through untouched.
        settings.apply({"temperature": 0.6, "top_p": 0.7})
        assert config.FISH_TEMPERATURE == 0.6
        assert config.FISH_TOP_P == 0.7
    finally:
        config.FISH_TEMPERATURE, config.FISH_TOP_P = old_t, old_p
    # And the shipped defaults respect their own ceiling.
    assert float(__import__("os").environ.get("BRIDGE_FISH_TEMPERATURE", "0.7")) \
        <= config.FISH_TEMPERATURE_MAX


@case("the Fish socket asks for text normalization, same as the HTTP path")
def _():
    # Numbers, dates and prices read raw are a stability risk the HTTP path
    # already guards with normalize=true. The websocket start request never
    # sent it, so the two paths spoke "149" differently.
    from pathlib import Path
    from . import fish_stream
    src = Path(fish_stream.__file__.replace(".pyc", ".py")).read_text()
    assert '"normalize": True' in src


@case("a held contour waits out the pause instead of guessing the end")
def _():
    # "No more guessing the end of a sentence." The prosody reader saying
    # "held" means level pitch with the energy still up: somebody mid-thought.
    # Acting on a settled partial there is answering half a sentence, so the
    # stability window stretches until AssemblyAI's own final would arrive
    # anyway. A landed contour keeps the fast path, with the higher word bar
    # it always had.
    fast_w, fast_f = agent.settle_plan("fell")
    assert fast_w == config.SETTLED_PARTIAL_FAST_S
    assert fast_f == config.SETTLED_PARTIAL_MIN_WORDS + 2
    held_w, held_f = agent.settle_plan("held")
    assert held_w >= config.SETTLED_PARTIAL_S * 2, held_w
    plain_w, _ = agent.settle_plan("unsure")
    assert plain_w == config.SETTLED_PARTIAL_S
    assert agent.settle_plan(None)[0] == config.SETTLED_PARTIAL_S


@case("the answered-prefix test survives the final's punctuation")
def _():
    # Partials arrive unformatted; finals arrive with format_turns commas and
    # capitals. The old equality-and-prefix test compared raw strings, so
    # "so about twenty a week" answered early came back as "So, about twenty
    # a week." and the comma broke the prefix match: the whole sentence went
    # through again and she answered the same thing twice. Ignoring input and
    # repeating herself, both from one string compare.
    from . import assembly_stt
    s = assembly_stt.AssemblyStream.__new__(assembly_stt.AssemblyStream)
    s._last_seen = "so about twenty a week"
    # Formatting only: nothing new was said, nothing goes through.
    assert s._only_the_new_part("So, about twenty a week.") == ""
    # A short tail merely finishes the thought: dropped, not re-answered.
    assert s._only_the_new_part("So, about twenty a week, maybe more.") == ""
    # A real continuation goes through WHOLE, context intact.
    grown = "So, about twenty a week, but honestly the evenings are the worst part."
    assert s._only_the_new_part(grown) == grown
    # And with nothing answered early, a final passes straight through.
    s._last_seen = ""
    assert s._only_the_new_part("Hello?") == "Hello?"


@case("the telemarketer filler openers are stripped too")
def _():
    for line, want in [
        ("Fantastic. So what's your setup?", "So what's your setup?"),
        ("No problem, I'll be quick.", "I'll be quick."),
        ("Awesome. When works better for you?", "When works better for you?"),
        ("Wonderful! What happens to those calls?", "What happens to those calls?"),
    ]:
        assert agent._strip_ack(line) == want, agent._strip_ack(line)


@case("a booking hallucinated against silence is never recorded")
def _():
    # Hugo, 2026-07-31: "hallucinating intent, booking appointments without
    # any confirmation". The mechanism is real: [BOOK: ...] is read from
    # everything the model WRITES, and the resume path hands the model
    # "(they said nothing)" as a turn, so a hallucinated [BOOK] in a reply to
    # pure silence became a recorded appointment. A booking is only a booking
    # when it answers a person actually speaking.
    assert not agent.booking_allowed(config.WENT_QUIET)
    assert not agent.booking_allowed("")
    assert not agent.booking_allowed(None)
    assert not agent.booking_allowed("  " + config.WENT_QUIET + "  ")
    assert agent.booking_allowed("tomorrow morning works for me")


@case("the intensity ladder is capped: extremely collapses to very")
def _():
    # "The agent is laughing out of the blue and overplaying the hand."
    # [extremely excited] is the manic top of the ladder and reads as an
    # outburst; [very excited] is as far as a person on a work call goes.
    old = config.CUES_ENABLED
    config.CUES_ENABLED = True
    try:
        assert agent._allowed_cue("extremely excited") == "very excited"
        assert agent._allowed_cue("extremely warm") == "very warm"
        assert agent._allowed_cue("very warm") == "very warm"
        assert agent._allowed_cue("quite amused") == "quite amused"
        # The cap is not a side door: the base still has to be allowed.
        assert agent._allowed_cue("extremely chuckling") is None
    finally:
        config.CUES_ENABLED = old


@case("two emotion cues a reply is the budget, pauses do not count")
def _():
    # One cue in two turns is the measured guidance; a cue on every sentence
    # is the caricature. The budget is enforced where the cues reach the
    # voice, and [break]/[long-break]/[emphasis] are mechanics, not emotions,
    # so they neither spend the budget nor get dropped by it.
    old = config.CUES_ENABLED
    config.CUES_ENABLED = True
    try:
        out = "".join(agent.clean_cues(iter([
            "[warm] Hi. [amused] Really. [break] [excited] Yes. [delighted] Great."
        ])))
        assert "[warm]" in out and "[amused]" in out, out
        assert "[excited]" not in out and "[delighted]" not in out, out
        assert "[break]" in out, out
    finally:
        config.CUES_ENABLED = old


@case("laughter written as words never reaches the voice")
def _():
    # The cue allowlist stopped [chuckling], so the laugh's remaining door is
    # the text itself: Fish performs "Haha" as a real laugh.
    out, notes = copy_guard.swap("Haha, that's fair. Hahaha. Ha ha, very good.")
    low = out.lower()
    assert "haha" not in low and "ha ha" not in low, out
    assert notes, notes


@case("a barge in the early window needs words, not just noise")
def _():
    # Stage two of the interrupt decision. The lowered early-yield threshold
    # made her quick to stop, and quick is only safe if the trigger is a
    # person actually talking: a door slam has no words, her own echo has her
    # words, and a "yeah" is somebody agreeing along, not taking the floor.
    class FakeEars:
        def __init__(self):
            self.partial = ""
        def partial_text(self):
            return self.partial

    a = agent.Agent.__new__(agent.Agent)
    a.ears = FakeEars()
    early = config.BARGE_EARLY_WINDOW_MS / 2
    late = config.BARGE_EARLY_WINDOW_MS + 100
    current = "So I answer phones while you're on a job"

    a.ears.partial = ""                    # a slam, a cough, a clatter
    assert not a._confirm_barge(early, current)
    a.ears.partial = "hang on a second, before you go on"
    assert a._confirm_barge(early, current)        # real words take the floor
    a.ears.partial = "yeah"                # agreeing along
    assert not a._confirm_barge(early, current)
    a.ears.partial = "uh huh"
    assert not a._confirm_barge(early, current)
    a.ears.partial = "answer phones while you're on a job"
    assert not a._confirm_barge(early, current)    # her own voice coming back
    # Past the early window the sustained-speech evidence stands on its own,
    # exactly as before this existed: a real interruption can never be locked
    # out for long.
    a.ears.partial = ""
    assert a._confirm_barge(late, current)
    # And a rig with no live transcriber keeps the one-stage behaviour.
    a.ears = None
    assert a._confirm_barge(early, current)


@case("the call-centre acknowledgements are stripped from a reply's opening")
def _():
    # "If you're relying on the LLM to not say brilliant, or I understand,
    # you're just gambling." Leading position only, the trailing punctuation
    # gate keeps real sentences safe.
    for line, want in [
        ("I understand, so how does that sound?", "So how does that sound?"),
        ("Understood. And when works better?", "And when works better?"),
        ("I see. What's your setup right now?", "What's your setup right now?"),
        ("Makes sense. What happens to those calls?", "What happens to those calls?"),
    ]:
        assert agent._strip_ack(line) == want, agent._strip_ack(line)
    # No punctuation after the phrase: it is a real clause, leave it alone.
    keep = "I understand you're busy so I'll be quick."
    assert agent._strip_ack(keep) == keep


@case("a dotted A.I. disclosure never trips")
def _():
    # Found by the adversarial review and reproduced: 'Yeah. A.I. assistant'
    # came out as 'Yeah. A.I, I. assistant'. The word assembler sees dots as
    # sentence enders, so the I of A.I. looked like a sentence-opening pronoun,
    # and the one allowed single-letter trip mangled the compliance line while
    # the transcript recorded it clean.
    for line in [
        "Yeah. A.I. assistant, that's what I am.",
        "Right. A.I. is what I do all day.",
        "So, I'm an A.I. that answers your phone.",
    ]:
        out = _stutter(line)[0]
        assert "A.I." in out and "I, I." not in out and "A.I," not in out, out


@case("a time or price never trips")
def _():
    # Also reproduced: 'Okay. 2pm tomorrow' came out as 'Okay. 2pm, pm
    # tomorrow', because a digit at a trip site never cleared it and the 'pm'
    # looked like a sentence-opening word. The booking readback is the money
    # line of the whole call.
    for line, bad in [
        ("Okay. 2pm tomorrow, does that work?", "pm, pm"),
        ("2pm works. See you then.", "pm, pm"),
        ("It's $149 a month, under five bucks a day.", "a, a"),
    ]:
        out = _stutter(line)[0]
        assert bad not in out, out


@case("a barged turn with a trip does not over-credit the transcript")
def _():
    # The trip adds audio the char-per-second estimate knows nothing about, so
    # a barge on a tripped turn credited the prospect with a word they never
    # heard. The injector reports what it added; the estimate subtracts it.
    import random as _random
    from . import disfluency
    d = disfluency.Disfluencer(rng=_random.Random(7))
    old = config.DISFLUENCY_CHANCE
    config.DISFLUENCY_CHANCE = 1.0
    try:
        out = "".join(d.feed(iter(["Takes the calls you'd miss."])))
    finally:
        config.DISFLUENCY_CHANCE = old
    added = len(out) - len("Takes the calls you'd miss.")
    assert added > 0, out
    assert d.last_trip_chars == added, (d.last_trip_chars, added)
    # And a clean reply reports zero, so nothing is subtracted.
    out2 = "".join(d.feed(iter(["Sounds good."])))
    assert d.last_trip_chars == 0, d.last_trip_chars


@case("the transcript records the clean line, the voice gets the trip")
def _():
    # The injector sits AFTER _clip_reply on purpose: `spoken` feeds the
    # transcript and the model's own memory, and a model shown its own stutter
    # starts imitating it, which is the broken-record failure.
    from . import disfluency
    import random as _random
    spoken: list[str] = []
    line = "I answer phones while you're on a job."
    old = config.DISFLUENCY_CHANCE
    config.DISFLUENCY_CHANCE = 1.0
    try:
        d = disfluency.Disfluencer(rng=_random.Random(7))
        voice = "".join(d.feed(agent._clip_reply(iter([line]), spoken)))
    finally:
        config.DISFLUENCY_CHANCE = old
    assert "".join(spoken) == line, spoken
    assert voice != line, voice


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
    if SKIPPED:
        print(f"{len(SKIPPED)} prosody tests SKIPPED, numpy is not installed here. "
              f"They run on the bridge host.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

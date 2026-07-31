"""Simulated disfluency: the small trip at the start of a thought.

Hugo, 2026-07-30: "you try to say one word and then you just say the first
letter and then you repeat again... very natural". He is right about the effect
and right about the danger: a voice that glides through every sentence is one
of the tells, and a voice that trips constantly is a broken record. The
difference is WHERE and HOW OFTEN, and neither can be left to the model. A
model told to stutter does it every other line, the same way it said
"brilliant" every other line when told to be warm. So, as with the cue
allowlist and the banned register, the behaviour lives in code.

Where a person actually trips is the start of a thought, when the sentence is
still being assembled: the reply's first word, or the first word after a full
stop where one thought hands over to the next. Mid-sentence trips exist in real
speech but read as a fault when synthesised, so they are not attempted.

Two shapes, both of which every TTS renders safely because they are ordinary
text:

    short word    "I, I answer phones"        the word said twice
    long word     "spe-specifically"           the first syllable, then the word

Rules, all enforced here rather than suggested anywhere:

  - at most ONE trip per reply
  - never two replies in a row (DISFLUENCY_MIN_GAP replies must pass)
  - DISFLUENCY_CHANCE per reply, so it stays an occasional thing
  - a slow brain (past DISFLUENCY_SLOW_S to the first token) raises the odds
    of a trip at the reply's start: that is the one moment a hesitation is
    genuinely being covered for, which is what makes it read as thinking
    rather than a tic
  - never inside a [cue], never on the word AI (a compliance record is not a
    toy), never on a number, never on a word of the business's name

THE TRANSCRIPT NEVER SEES THE TRIP. This stage sits downstream of _clip_reply,
so `spoken` (the transcript, and what the model is told it said) records the
clean line while the voice performs the trip. Shown its own stutter, the model
starts imitating it, and one trip per call becomes one per sentence.
"""
from __future__ import annotations

import random
import re
import time

from . import config

# A word, as the injector sees one: letters and apostrophes. Digits are
# excluded here, and the site-clearing rule in feed() is what actually protects
# a mixed token: this regex alone let "2pm" trip as "pm, pm", because the
# letters after the digit looked like a word starting a sentence.
_WORD = re.compile(r"[A-Za-z']+$")
# The first syllable of a long word: leading consonants and the first vowel
# run. "specifically" -> "spe", "problem" -> "pro", "evening" -> "e".
_SYLLABLE = re.compile(r"^[bcdfghjklmnpqrstvwxz]{0,3}[aeiouy]+")
# Words that must never be doubled. "AI" is the disclosure; a doubled filler
# word is the exact noise _drop_leading_ack exists to remove. The dotted form
# "A.I." is not here because a dot can never enter the word buffer: it is
# handled structurally instead, a word abutting a preceding dot is an
# abbreviation fragment and is never eligible (see feed()).
_NEVER = frozenset({"ai", "um", "uh", "erm", "mm", "right", "okay",
                    "ok", "yeah", "yes", "no", "so"})
# Long enough for the syllable shape; anything shorter is said twice in full.
_SYLLABLE_MIN = 7

# Words that open the closing question on these calls. A sentence boundary
# followed by one of these is the pivot of the reply, and the beat before it
# is where a speaker actually breathes.
_QUESTION_OPENERS = frozenset({
    "what", "how", "would", "could", "does", "do", "which",
    "when", "where", "who", "shall",
})


def _trip(word: str) -> str | None:
    """The tripped form of one word, or None if this word is off limits."""
    # "I, I think" is the single most human trip there is, so "I" is the one
    # single-letter word allowed. "a, a" is not a stutter, it is a fault.
    if not _WORD.match(word) or (len(word) < 2 and word != "I"):
        return None
    if word.lower().strip("'") in _NEVER:
        return None
    if len(word) >= _SYLLABLE_MIN and word[0].islower():
        m = _SYLLABLE.match(word.lower())
        if m and len(m.group(0)) < len(word) - 2:
            return f"{m.group(0)}-{word}"
    # Second copy lowercased: "They'd, they'd just" is how it is written down,
    # and the capital belongs to the sentence, not the repeat. Except the
    # pronoun: "I, i answer" is not English.
    second = word if word == "I" or word.startswith("I'") else word[0].lower() + word[1:]
    return f"{word}, {second}"


class Disfluencer:
    """Injects at most one trip per reply into a streaming text pipeline.

    One instance per call, because the gap between trips is counted in replies
    and has to survive from one turn to the next.
    """

    def __init__(self, rng: random.Random | None = None,
                 business_words: tuple[str, ...] = (), on_event=None):
        self.rng = rng or random.Random()
        self.business_words = frozenset(w.lower() for w in business_words)
        self.on_event = on_event or (lambda kind, text: None)
        # Start eligible: the gap rule is "never twice in a row", not "never
        # early in the call".
        self._since = config.DISFLUENCY_MIN_GAP
        # How many characters the last reply gained from its trip. The barge-in
        # arithmetic reads this: injected audio the char-per-second estimate
        # does not know about would otherwise credit the prospect with a word
        # they never heard.
        self.last_trip_chars = 0

    def _eligible(self, word: str) -> bool:
        return (_trip(word) is not None
                and word.lower().strip("'") not in self.business_words)

    def feed(self, tokens):
        """Yield the stream with at most one trip and one breath added.

        Generator per reply. The trip is the stutter at the start of a
        thought; the breath is a [break] before the closing question, the one
        pivot these replies actually have, which Fish renders as a natural
        intake rather than a synthesised noise.
        """
        t0 = time.monotonic()
        self.last_trip_chars = 0
        want = self._since >= config.DISFLUENCY_MIN_GAP
        want_breath = False
        decided_chance = False
        injected = False
        breathed = False
        slow = False
        sentences_ended = 0
        saw_alpha = False
        # Where a trip may land: True at the reply's start and after .!?
        at_site = True
        depth = 0            # inside a [cue]
        word = ""            # the word being assembled at a site
        # The character that came immediately before the word being assembled.
        # "A.I." is seen by this loop as the words "A" and "I" with dots
        # between them, and the dot re-arms the site, so without this the I of
        # the disclosure was the first eligible trip on exactly the lines that
        # open with a protected word ("Yeah. A.I. ..."). A word abutting a dot
        # is an abbreviation fragment, never a word.
        prev = ""
        before_word = ""

        def flush_word(w: str) -> str:
            nonlocal injected, breathed, at_site
            at_site = False
            if not w:
                return w
            if before_word == ".":
                return w                   # an abbreviation fragment
            # The breath first: a site word opening a question after at least
            # one finished sentence is the pivot, and one shaping event per
            # moment is plenty, so a breath here forgoes the trip.
            if (want_breath and not breathed and sentences_ended >= 1
                    and w.lower() in _QUESTION_OPENERS):
                breathed = True
                self.on_event("disfluency", f"[break] before {w!r}")
                return f"[break] {w}"
            if injected or not want:
                return w
            tripped = _trip(w) if self._eligible(w) else None
            if tripped is None:
                return w
            injected = True
            # A slow brain hesitates BEFORE it trips: the pause plus the
            # restart is what a person assembling a hard thought sounds like,
            # where a bare trip is just the ordinary stumble of speech.
            if slow:
                tripped = f"[break] {tripped}"
            self.last_trip_chars = len(tripped) - len(w)
            self.on_event("disfluency", f"{w} -> {tripped}")
            return tripped

        try:
            for token in tokens:
                if not decided_chance:
                    decided_chance = True
                    # The brain took long enough that a human would audibly
                    # hesitate here. A trip at the reply's start covers it:
                    # thinking made audible, without a call centre's "one
                    # moment please".
                    slow = time.monotonic() - t0 >= config.DISFLUENCY_SLOW_S
                    chance = 0.85 if slow else config.DISFLUENCY_CHANCE
                    want = want and self.rng.random() < chance
                    want_breath = self.rng.random() < config.BREATH_CHANCE
                if (not want or injected) and (not want_breath or breathed):
                    if word:
                        yield word
                        word = ""
                    yield token
                    continue
                out: list[str] = []
                for ch in token:
                    if ch == "[":
                        if word:
                            out.append(flush_word(word))
                            word = ""
                        depth += 1
                        out.append(ch)
                        prev = ch
                        continue
                    if depth:
                        out.append(ch)
                        if ch == "]":
                            depth -= 1
                        prev = ch
                        continue
                    if ch.isalpha():
                        saw_alpha = True
                    if at_site and (ch.isalpha() or ch == "'"):
                        if not word:
                            before_word = prev
                        word += ch
                        prev = ch
                        continue
                    if word:
                        out.append(flush_word(word))
                        word = ""
                    if ch in ".!?":
                        if saw_alpha:
                            sentences_ended += 1
                        at_site = True
                    elif at_site and not ch.isspace():
                        # A digit, a bracket, a quote: whatever it is, the word
                        # that follows it is not the start of a spoken thought.
                        # Without this, "Okay. 2pm tomorrow" tripped as
                        # "2pm, pm tomorrow", garbling the booking readback.
                        at_site = False
                    out.append(ch)
                    prev = ch
                piece = "".join(out)
                if piece:
                    yield piece
            if word:
                yield flush_word(word)
                word = ""
        finally:
            # In the finally so a barge-in abandoning the generator still
            # counts the reply. Without this, a trip that was cut off midway
            # never started the gap clock, and the very next reply could trip
            # again: twice in a row, the exact thing the gap rule forbids.
            self._since = 0 if injected else self._since + 1

"""The conversation loop.

Dial, wait for a real answer, open, then listen and reply until somebody hangs
up. Transport-agnostic: hand it a SimTransport today or a VoIP transport later.
"""
from __future__ import annotations

import difflib
import json
import math
import queue
import random
import re
import threading
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

from . import ai, audio, config, copy_guard, disfluency, stages
from .transport import CaptureFailed, Transport

# One pattern, used both to detect the end-of-call marker and to strip it. They
# used to be separate, a literal "[END]" test and a whitespace-tolerant regex, so
# "[ END ]" was quietly removed from the speech and never ended the call: the
# agent agreed to take an annoyed prospect off the list, then stayed on the line.
_MARKER_RE = re.compile(r"\[\s*END\s*\]", re.IGNORECASE)
# The model asking to move to the next stage. It only ever ASKS: the code in
# bridge/stages.py decides, and a reply without this marker leaves her exactly
# where she was. Whitespace-tolerant for the same reason [END] is, because
# "[ NEXT ]" being stripped from the speech but not recognised would leave her
# silently stuck on one stage for the whole call.
# Which way she wants the conversation to go: [GO: yes], [GO: busy], [GO: no].
# She picks the road, stages.py owns the map. An exit that does not belong to
# the stage she is on is ignored, so she cannot invent a path.
_GO_RE = re.compile(r"\[\s*GO\s*:\s*([a-z_]{1,16})\s*\]", re.IGNORECASE)
# The slot they agreed to, written by the model as [BOOK: Thursday 2pm]. Kept
# deliberately loose about what goes after the colon, because a person says
# "Thursday about two" and "tomorrow morning" and both are better recorded as
# said than forced into a format that loses what they meant.
_BOOK_RE = re.compile(r"\[\s*BOOK\s*:\s*([^\]]{1,60})\]", re.IGNORECASE)
# Emotion cues are for the voice, not for the record. They must survive all the
# way to Fish, so they are stripped only where text is shown or stored.
# Commas allowed: the model writes compound cues like "[warm, professional]" of
# its own accord. clean_cues already refuses to send those to the voice, since
# they are not on the allowlist, but a narrower pattern here left them sitting in
# the saved transcript as if they had been spoken.
_CUE_RE = re.compile(r"\[[a-z][a-z\s,-]{0,30}\]", re.IGNORECASE)
# A cue AND the space after it, for word counting. Swallowing the trailing
# space keeps the off-by-one identical to an uncued line, so "[warm] Hi." and
# "Hi." count the same rather than differing by one.
_CUE_SPAN_WS = re.compile(r"\[[^\]]*\]\s*")
# An interruption can cut a reply off in the middle of a cue, leaving a dangling
# "[" or "[curi" with no closing bracket. It never reaches the voice, because
# clean_cues holds an unclosed bracket back and drops it, but the transcript is
# built from the raw tokens and so recorded a line as literally "[" on a live
# call. Cosmetic, and misleading in exactly the place we go to read what
# happened.
_PART_CUE_RE = re.compile(r"\[[a-z\s-]*$", re.IGNORECASE)
# "an AI assistant", "I'm an A.I." and so on. Word boundaries keep it off every
# ordinary word that happens to contain those two letters.
_DISCLOSED_RE = re.compile(r"\bA\.?\s?I\.?\b|artificial intelligence", re.IGNORECASE)
# An agreement murmured along under somebody talking: "yeah", "right",
# "uh huh". Not an interruption, the opposite of one, and stopping for it is
# how she "snaps shut" mid-thought. Distinct from _STANDALONE_REPLY, which is
# about words that ANSWER a question once she has stopped; "what" and "sorry"
# belong there and are real interruptions here.
# Checked word by word, so "uh huh" and "mm hmm" are covered by their parts:
# a two-entry phrase in this set would never match anything.
_AGREEMENT_MURMURS = frozenset({
    "yeah", "yes", "yep", "yup", "right", "okay", "ok", "sure",
    "mm", "mhm", "hmm", "uh", "huh", "gotcha", "true", "fair",
})

# Words that are a complete reply on their own. These are never mistaken for
# her own echo, however well they match what she just said, because discarding
# one means ignoring the answer she asked for.
_STANDALONE_REPLY = {
    "yes", "yeah", "yep", "yup", "no", "nope", "nah", "sure", "okay", "ok",
    "right", "hello", "hi", "what", "sorry", "pardon", "again", "why", "who",
    "when", "where", "how", "maybe", "fine", "alright", "cheers", "thanks",
    "bye", "stop", "go", "on", "please", "wait", "hang", "hold", "speaking",
}


def spoken_words(text: str) -> str:
    """What a human would say was said, with the performance cues removed."""
    return re.sub(r"\s+", " ", _PART_CUE_RE.sub(" ", _CUE_RE.sub(" ", text))).strip()

# Speaking rate of the voice, used to estimate how much of a sentence actually
# reached the prospect before they cut in. Measured on Fish at prosody speed
# 1.0: "Right. And are you asking customers for them now?" is 48 characters and
# runs 3.10s at speed 1.1, so 15.5 chars a second there and 14.1 at 1.0.
# Derived from the live speed rather than hardcoded, because that setting is on
# the agent page and somebody moving it would silently skew every estimate.
BASE_CHARS_PER_SECOND = 14.0


def chars_per_second() -> float:
    return BASE_CHARS_PER_SECOND * max(0.5, float(config.FISH_SPEED))


def settle_plan(contour: str | None) -> tuple[float, int]:
    """(stability wait, minimum words) for acting on a settled partial.

    The one decision that separates quick from rude. A landed contour (fell or
    rose) is the voice itself saying the sentence is over, so the short wait is
    safe and only the word floor rises. A HELD contour is the opposite
    evidence: level pitch with the energy still up is somebody mid-thought,
    and acting on their pause is answering half a sentence, so the window
    stretches until AssemblyAI's own patient end-of-turn call would land
    anyway. No reading at all keeps the middle road it always had.
    """
    if contour in ("fell", "rose"):
        return config.SETTLED_PARTIAL_FAST_S, config.SETTLED_PARTIAL_MIN_WORDS + 2
    if contour == "held":
        return config.SETTLED_PARTIAL_S * config.HELD_PATIENCE, config.SETTLED_PARTIAL_MIN_WORDS
    return config.SETTLED_PARTIAL_S, config.SETTLED_PARTIAL_MIN_WORDS


def barge_threshold_ms(elapsed_ms: float, base_ms: float) -> float:
    """How much sustained speech counts as an interruption, right now.

    The race. When both sides start in the same breath, the human wins, and
    quickly: for the first BARGE_EARLY_WINDOW_MS of her turn the threshold is
    halved, so a prospect who was already talking when her audio began stops
    her in about 350ms. Past the window the full threshold is back, and a
    cough or an "mm" mid-reply still cannot stop her. The barge grace window
    runs before this ever applies, so her own first-syllable echo cannot ride
    the lowered bar.
    """
    if elapsed_ms < config.BARGE_EARLY_WINDOW_MS:
        return base_ms * config.BARGE_EARLY_FACTOR
    return base_ms


def question_was_asked(voice_text: str, delivered: str) -> bool:
    """Did the prospect actually hear the question this reply ended with?

    The waiting rule ("silence after a question is a person thinking, not a
    stalemate") used to test whether the DELIVERED text ends with a question
    mark. But a barge-in cuts at a moment the prospect chooses, and on a live
    call it landed one word before the mark: "...to get you set up?" was heard
    as "...to get you set", the wait rule saw no question, and the resume
    shortcut fired a follow-up while the man was still deciding his answer.
    That is the "interrogation" feel in one mechanism.

    So the test is on the reply she was SAYING, not the fragment that
    survived: if the reply ends with a question and the cut landed at least
    80% of the way through that question sentence, the question was asked in
    any sense a human would recognise, and silence now means somebody
    thinking. A cut much earlier means they never heard the question, and
    resuming to finish it beats waiting for an answer to half a sentence.
    """
    text = voice_text.rstrip()
    if not text.endswith("?"):
        return False
    # Start of the final sentence: the character after the previous ender.
    q_start = max(text.rfind(c, 0, len(text) - 1) for c in ".!?") + 1
    q_len = len(text) - q_start
    if q_len <= 0:
        return False
    heard_of_q = len(delivered.rstrip()) - q_start
    return heard_of_q >= 0.8 * q_len


def _finish_word_ms(text: str, elapsed_ms: float) -> float:
    """How much longer she needs to finish the word she is in the middle of.

    A fixed delay cannot do this job, which is why raising it from 200ms to
    350ms did not fix it and Hugo still heard chopped words. The cut lands at a
    random point, so adding a constant just moves the chop to a different random
    point. Sometimes that is mid-word again.

    This works out where in the sentence she actually is, from how long she has
    been speaking, and waits precisely until the next space. Cutting there is
    the difference between "can I just ask how ma-" and "can I just ask how".

    Falls back to the fixed setting when there is no text to measure against,
    for instance a barge-in during a backchannel, and is capped by it times
    three so a bad estimate can never hold the line open.
    """
    if not text:
        return float(config.FINISH_WORD_MS)
    cps = chars_per_second()
    pos = (elapsed_ms / 1000.0) * cps
    if pos >= len(text):
        return 0.0                      # already past the end, nothing to finish
    # ceil, not int. Truncating looks BACKWARDS at a space already spoken and
    # returns a negative wait, and time.sleep() raises ValueError on a negative
    # number, which would end the call rather than the sentence. Rounding up
    # asks the right question: where does the word I am inside of end?
    nxt = text.find(" ", math.ceil(pos))
    if nxt < 0:
        nxt = len(text)
    return max(0.0, min((nxt - pos) / cps * 1000.0, config.FINISH_WORD_MS * 3.0))


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


# A spaced hyphen is a long dash wearing a disguise. The model produced
# "I don't know the figure - the team handles that" on a live call, which slips
# past the table above because a plain hyphen is legitimate inside a word.
# Only the spaced form is a dash.
_SPACED_HYPHEN = re.compile(r"\s+-\s+")
# A cue dropped from just before a comma left "you're talking to me now , this
# is what I do". Putting a space where a cue was is right in general and wrong
# next to punctuation, so it is taken back out.
_SPACE_BEFORE_PUNCT = re.compile(r"\s+([,.!?;:])")
# And the mirror image, which turned up on a live call as "right now,this call
# is the demonstration". A comma, semicolon or colon always wants a space after
# it; a full stop only when a capital follows, so "e.g." and "3.20" survive.
_MISSING_SPACE = re.compile(r"([,;:])(?=[A-Za-z])|([.!?])(?=[A-Z])")


# Currency that ASCII folding would silently delete rather than read. "£149"
# with the pound sign dropped becomes "149", which is a different price.
_CURRENCY = {"£": "GBP ", "€": "EUR "}


def straighten(text: str) -> str:
    """Replace punctuation we never use, then fold everything to ASCII.

    The fold is the language firewall. Fish performs whatever characters it is
    given: one CJK or Cyrillic glyph in the text invites a language switch,
    an emoji invites an improvised noise. The model is told to write plain
    American English, and told-in-the-prompt has never once held here, so the
    constraint is enforced at the last gate instead. NFKD first, so accented
    Latin flattens to its base letter ("café" -> "cafe") rather than
    vanishing and garbling the word.
    """
    for bad, good in _PUNCTUATION.items():
        text = text.replace(bad, good)
    for bad, good in _CURRENCY.items():
        text = text.replace(bad, good)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = _SPACED_HYPHEN.sub(", ", text)
    text = _SPACE_BEFORE_PUNCT.sub(r"\1", text)
    return _MISSING_SPACE.sub(lambda m: (m.group(1) or m.group(2)) + " ", text)


def _strip_marker(text: str) -> str:
    """Remove the control markers wherever the model put them, and tidy.

    Both of them, always. Saying the literal text "[NEXT]" down the phone would
    be as humiliating as saying "[END]".
    """
    clean = _BOOK_RE.sub(" ", _GO_RE.sub(" ", _MARKER_RE.sub(" ", text)))
    return re.sub(r"\s+", " ", straighten(clean)).strip()


def _has_marker(text: str) -> bool:
    return _MARKER_RE.search(text) is not None


def chosen_exit(text: str) -> str | None:
    """Which way she asked to go. She asks; stages.py decides if it exists."""
    m = _GO_RE.search(text or "")
    return m.group(1).strip().lower() if m else None


def booked_slot(text: str) -> str | None:
    """The day and time they agreed, if the model recorded one."""
    m = _BOOK_RE.search(text or "")
    return " ".join(m.group(1).split()) if m else None


def booking_allowed(heard) -> bool:
    """May a [BOOK] in this reply be recorded as a real appointment?

    Only when it answers a person actually speaking. The marker is read from
    everything the model WRITES, and the resume path hands the model
    "(they said nothing)" as a turn, so a hallucinated [BOOK] in a reply to
    pure silence became a recorded appointment with nobody's agreement in it.
    A booking is a state change, and silence never authorises a state change.
    """
    if not heard or not str(heard).strip():
        return False
    return str(heard).strip() != config.WENT_QUIET


# Words that mean the thought is still going, even though the sound stopped.
# Somebody saying "we've got about twenty, but" has not finished, and answering
# there talks over the important half of the sentence.
_UNFINISHED_TAIL = {
    "and", "but", "so", "or", "because", "cos", "if", "when", "while", "though",
    "although", "unless", "since", "that", "which", "who", "the", "a", "an",
    "to", "of", "for", "with", "at", "in", "on", "is", "was", "we", "i", "it",
    "they", "you", "my", "our", "their", "like", "just", "well", "erm", "um",
    "uh", "actually", "basically", "obviously", "yeah",
    # Contractions. The tokenizer keeps apostrophes, so "you're" is its own
    # token and "you" above never matches it. Hugo said "When, when you're"
    # and she answered over the second half of his sentence, because nobody
    # ends a sentence on "you're". Only forms that cannot close a thought:
    # "it's" and "that's" are left out, "that's it" ends plenty of sentences.
    "you're", "we're", "they're", "i'm", "i've", "you've", "we've", "i'll",
    "you'll", "we'll", "i'd", "you'd", "we'd", "gonna",
}


# Noises somebody makes while thinking. A turn made of nothing but these is not
# an answer, it is the sound of somebody working out how to answer, and the only
# right response to it is to keep quiet. On a live call she asked "how often's
# that happening?", got "Um.", and rephrased the question. Then got "Um." again
# and rephrased it a second time: three questions in ten seconds, over the top
# of a man trying to think.
_FILLER_ONLY = {
    "um", "uh", "er", "erm", "hmm", "hm", "mm", "mmm", "ah", "oh", "eh",
    "well", "so", "like", "y'know", "you know", "i mean", "let me see",
    "let's see", "hang on", "hold on", "one sec", "just a sec",
}


def is_thinking_noise(text: str) -> bool:
    """Is this somebody thinking rather than answering?

    Deliberately narrow. "Yeah" and "okay" are real answers and are NOT here,
    however unhelpful they sometimes are, because discarding one means ignoring
    something the prospect actually said.
    """
    words = re.sub(r"[^\w\s']", " ", text.lower()).split()
    if not words or len(words) > 3:
        return False
    joined = " ".join(words)
    if joined in _FILLER_ONLY:
        return True
    return all(w in _FILLER_ONLY for w in words)


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
        # Count SPEECH, not tags. clean_cues wraps this from the outside, so
        # the text here still carries "[very warm] " and every one of those
        # spent a word of the budget.
        #
        # That is not cosmetic. Measured over 400 realistic turns shaped
        # "statement. statement. closing question?", adding a single cue
        # changed the output on 25 of them, and in 25 out of 25 the thing
        # deleted was THE CLOSING QUESTION. Which is the exact way every
        # prospect who got this far was lost: she stops on a full stop, they
        # are left holding silence, they hang up.
        #
        # It was also perversely coupled. The more feeling she put into a line,
        # the more likely her question got chopped, so the two things we have
        # been tuning all day were fighting each other through a word counter.
        words = _CUE_SPAN_WS.sub("", text).count(" ")
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
#
# THE LEADING GROUP IS A RUN, not one tag. The prompt actively recommends
# stacking ("[warm][amused]") and intensifiers ("[very warm, quite playful]"),
# and the old single-tag pattern matched none of those, so _strip_ack returned
# "[warm][amused] Right, ..." completely unchanged. On exactly those turns the
# backchannel said "Right." and then she said "Right." again: the doubled
# filler Hugo reported, alive again on the most expressive lines.
#
# The trailing "\s*[,.!]+" is load-bearing and must not be relaxed. It is the
# entire reason this cannot eat a real sentence: it spares "Right person to
# speak to", "In short supply of engineers" and "Certainly not, we do that
# ourselves", because none of those has punctuation after the first word.
_ACK_OPENER = re.compile(
    r"^((?:\s*\[[a-z][a-z\s,-]{0,30}\]\s*)+)?"
    r"\s*"
    r"(right|okay|ok|yeah|yep|yes|sure|gotcha|got it|mm+|mm hmm|no worries|"
    r"understood|i understand|i see|i hear you|makes sense|"
    r"fantastic|awesome|wonderful|amazing|lovely|no problem|not a problem|"
    r"fair enough|absolutely|of course|certainly|great|perfect|brilliant|"
    r"that[' ’]?s a (?:good|great|fair) question|"
    r"in short|to sum up|to summari[sz]e|furthermore|moreover|additionally|"
    r"consequently)"
    r"\s*[,.!]+\s*",
    re.IGNORECASE,
)


def _strip_ack(text: str) -> str:
    """Remove a leading acknowledgement and repair the capital it took with it.

    Stripping "Okay, " off "Okay, so you're doing it all yourself?" leaves a
    sentence starting with a lowercase "so". Heard on a live call, and it reads
    as her having lost her thread.
    """
    # TWO BITES. "Fair enough, that's a good question, so..." is two cushions
    # stacked, and one pass leaves the second one to be spoken.
    out = text
    for _ in range(2):
        nxt = _ACK_OPENER.sub(lambda m: m.group(1) or "", out, count=1)
        if nxt == out:
            break
        out = nxt
    if out == text:
        return out
    # Step over a leading cue tag ENTIRELY before capitalising. Walking
    # character by character capitalises the cue instead, turning
    # "[curious] Right, so..." into "[Curious] so...", which is both wrong and
    # invisible until it reaches a call.
    i = 0
    while i < len(out):
        if out[i] == " ":
            i += 1
        elif out[i] == "[":
            close = out.find("]", i)
            if close < 0:
                break
            i = close + 1
        else:
            break
    if i < len(out) and out[i].isalpha():
        return out[:i] + out[i].upper() + out[i + 1:]
    return out


def _drop_leading_ack(tokens, acked: bool = False):
    """Do not say the acknowledgement twice.

    The backchannel plays "Right." while the model is still writing. The model
    then writes "Right. And are you asking customers now?" of its own accord: it
    did it on three runs out of three when measured. So the prospect hears
    "Right." ... "Right. And are you..." and it sounds exactly like Hugo said it
    did, "saying thing like Right / yeah when makes no sense and no context".

    Two independent sources of the same filler word. The backchannel keeps the
    job, because it is what covers the thinking gap, and the model's copy is
    removed here.

    Applied on EVERY turn, not only acked ones. Gating it on an acknowledgement
    having played still let "Right. You're talking to me now" through on the
    turns where none did.

    `acked` therefore does not decide whether to strip, only what to do when
    stripping leaves NOTHING. A reply that is nothing but an acknowledgement,
    "Of course." or "Perfect.", strips to the empty string, and yielding
    nothing means she says nothing at all: the prospect has just spoken and
    gets dead air, and two silent rounds end the call as went_quiet. So when
    there is nothing speakable left, say the original, unless the backchannel
    has already made that exact noise, in which case silence is correct.
    """
    def speakable(s):
        # Cue tags are not words. "[warm] " is truthy and says nothing.
        return bool(spoken_words(s or "").strip())

    buf = ""
    decided = False
    for token in tokens:
        if decided:
            yield token
            continue
        buf += token
        # Measure SPEECH, not tags. A run of stacked cues can be 28 characters
        # on its own, which decided the turn before the cushion had even
        # arrived and made the strip a no-op on exactly the expressive lines.
        if len(spoken_words(buf)) < 28 and len(buf) < 72:
            continue                       # not yet enough to judge
        decided = True
        head = _strip_ack(buf)
        if speakable(head):
            yield head
        elif not acked:
            yield buf
    if not decided and buf:
        head = _strip_ack(buf)
        if speakable(head):
            yield head
        elif not acked:
            yield buf


# Fish documents intensity modifiers as a first-class feature: "[slightly sad]",
# "[very excited]", "[extremely angry]". They are the finest control available
# over how much emotion a line carries, which is exactly what "needs a little
# more" asks for. The allowlist is exact-match, so without this every one of
# them would be silently dropped and the prompt would be asking for something
# the code throws away.
_INTENSITY = {"slightly", "a bit", "mildly", "quite", "fairly", "rather",
              "really", "very", "extremely", "genuinely"}

# Delivery mechanics rather than feelings. Exempt from the per-reply emotion
# budget: dropping a [break] because the reply had already emoted twice would
# delete a pause that was doing timing work, not emotional work.
_MECHANIC_CUES = frozenset({"break", "long-break", "emphasis"})


def _allowed_cue(raw: str) -> str | None:
    """The cue to send to Fish, or None to drop it.

    Safe on its own, or a safe one with an intensity word in front. The BASE
    still has to be on the allowlist, so "[very chuckling]" is refused exactly
    like "[chuckling]" is and the laugh cannot come back in through the side
    door.
    """
    if not config.CUES_ENABLED:
        return None
    cue = " ".join(raw.strip().lower().split())
    base = cue
    for word in _INTENSITY:
        if cue.startswith(word + " "):
            base = cue[len(word) + 1:]
            break
    # The noise check runs on BOTH forms, so "[very chuckling]" is refused
    # exactly like "[chuckling]" and the laugh has no side door.
    if cue in config.NOISES or base in config.NOISES:
        return None
    if base not in config.SAFE_CUES:
        return None
    # The intensity ladder is capped at "very". [extremely excited] performs
    # as an outburst, and nobody on a work call is extremely anything. Hugo,
    # 2026-07-31: "overplaying the hand, which makes it feel like a
    # caricature and not a person".
    if cue.startswith("extremely "):
        cue = "very " + base
    return cue


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

    AND THE BUDGET. Two emotion cues per reply, in code, because "about one
    turn in two" in the prompt still produced replies wearing a different
    feeling on every sentence, which is the caricature Hugo reported. The
    mechanics ([break], [long-break], [emphasis]) are not emotions: they
    neither spend the budget nor get dropped by it.
    """
    spent = 0
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
            cue = _allowed_cue(text[start + 1:end])
            if cue and cue not in _MECHANIC_CUES and spent >= config.CUE_BUDGET:
                cue = None                 # the reply has emoted enough
            if cue:
                if cue not in _MECHANIC_CUES:
                    spent += 1
                out.append(f"[{cue}]")
            else:
                # A space, not nothing. The model writes cues with no spaces
                # around them often enough ("right now,[pause]this is what I
                # do"), and deleting one outright fused the words either side
                # into "now,this". Seen twice on live calls. The collapse below
                # tidies up the doubles this creates.
                out.append(" ")
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
    chars = int((elapsed_ms / 1000.0) * chars_per_second())
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
    # The onboarding slot they agreed, in their own words. The entire point of
    # the call, so it goes on the result rather than being left in the text for
    # somebody to find later.
    booked: str | None = None

    @property
    def duration(self) -> float:
        return max(0.0, self.ended_at - self.started_at)

    def to_dict(self) -> dict:
        return {
            "number": self.number,
            "answered": self.answered,
            "duration_s": round(self.duration, 1),
            "outcome": self.outcome,
            "booked": self.booked,
            "error": self.error,
            "turns": [{"who": t.who, "text": t.text, "at": round(t.at, 1)} for t in self.turns],
        }


# Words that appear in half the plumbers in America, so finding one in a
# greeting proves nothing about whether they announced THEMSELVES. Only the
# distinctive part of a name is evidence.
_GENERIC_TRADE_WORDS = frozenset({
    "plumbing", "plumber", "plumbers", "heating", "cooling", "drain",
    "drains", "sewer", "rooter", "services", "service", "company",
    "solutions", "contractors", "contracting", "incorporated", "limited",
    "brothers", "sons", "group", "systems", "mechanical", "emergency",
    "repair", "installation", "residential", "commercial", "water",
})


class Agent:
    def __init__(
        self,
        transport: Transport,
        system_prompt: str,
        opener: str,
        stt: ai.SpeechToText | None = None,
        tts: ai.TextToSpeech | None = None,
        on_event=None,
        business: str | None = None,
    ):
        self.transport = transport
        self.stt = stt or ai.WhisperSTT()
        self.tts = tts or ai.build_tts()
        self.brain = ai.Brain(system_prompt)
        self.opener = opener
        # NO NAME HERE, deliberately. The permission stage's job is to give her
        # name, and when the opener did it too she said "Hi there, it's Maria"
        # twice in a row to Beach Plumbing. Leaving the name to one owner means
        # the brief stays correct whichever opener gets used: the cold one asks
        # who they are, this one just acknowledges, and the introduction always
        # happens exactly once, in the turn after.
        self.opener_warm = "[warm] Hi there."
        # The distinctive words of their name, for spotting it coming back at
        # us in their greeting. Four letters and up, and the generic trade
        # words dropped, so "Plumbing" cannot match every plumber who says
        # "plumbing" while answering a phone. What is left is the bit that is
        # actually theirs: "waterways", "chavarria".
        self.business_words = tuple(
            w for w in re.findall(r"[a-z]+", (business or "").lower())
            if len(w) >= 4 and w not in _GENERIC_TRADE_WORDS
        )
        self.on_event = on_event or (lambda kind, text: None)
        # Replaced with this line's measured quiet level once the call connects.
        self._baseline = -55.0
        # When the prospect stopped talking, so lag can be measured honestly.
        self._heard_at = 0.0
        # The last thing SHE said, and when she stopped. Used to recognise her
        # own voice coming back off the prospect's handset.
        self._last_spoken = ""
        self._stopped_at = 0.0
        # A live voice stream, if the caller handed one over. When present every
        # reply starts speaking in about a quarter of a second instead of
        # waiting for the whole clip to render.
        self.voice_stream = None
        # A live transcription socket, if the caller handed one over. When
        # present it replaces the VAD, the end-of-turn wait and batch Whisper.
        self.ears = None
        # A pitch and loudness reader on the far end, if the caller handed one
        # over. Optional on purpose: without it everything behaves as before.
        self.prosody = None
        # What their last turn's contour did ("fell", "rose", "held", "unsure"),
        # captured just before the prosody reader is reset. The backchannel
        # gate reads it: "Right." answers a landed statement and nothing else.
        self._last_contour: str | None = None
        # Set when the reply she just gave asked a question the prospect
        # actually heard, even if the barge-in cut the "?" itself off. The
        # waiting rule reads this so a clipped question still gets waited on
        # instead of chased with a follow-up.
        self._question_pending = False
        # The occasional trip at the start of a thought. One instance per call:
        # the never-twice-in-a-row rule counts replies across turns.
        self._disfluencer = disfluency.Disfluencer(
            business_words=self.business_words, on_event=self.on_event)
        # The last stage she reached, for the campaign ledger. Set by
        # _set_stage; None means the call never got as far as starting one.
        self.last_stage: str | None = None
        self._backchannel: list[tuple[str, bytes]] = []
        # Generate the opener NOW, while the phone is still ringing, instead of
        # after they say hello. It used to be made on answer, so its generation
        # time landed as dead air at the very start of every call, which is the
        # worst possible place for it. Nobody is waiting during the ring.
        self._opener_audio: bytes | None = None
        # A SECOND opener, for when they answer by announcing themselves.
        #
        # US trades do not say "hello", they say "Waterways Plumbing and Drain
        # Cleaning, this is Mike". Asking "is that Waterways Plumbing and Drain
        # Cleaning?" back at that is asking a man to confirm the name he said
        # two seconds ago, and it is the most robotic thing on the call. It
        # happened to Mike verbatim, and he hung up two turns later.
        #
        # Rendered during the ring alongside the other one, so choosing between
        # them on answer costs nothing. Deliberately name-free: we cannot know
        # his name before he says it, and "Hi there" is what a person says
        # while they are still catching it.
        self._opener_warm_audio: bytes | None = None
        threading.Thread(target=self._prepare_opener, daemon=True).start()
        threading.Thread(target=self._prepare_backchannel, daemon=True).start()

    def _prepare_opener(self) -> None:
        try:
            self._opener_audio = self.tts.say(straighten(self.opener))
        except Exception as e:
            self._emit("error", f"opener TTS failed, will retry on answer: {e}")
        try:
            self._opener_warm_audio = self.tts.say(straighten(self.opener_warm))
        except Exception as e:
            self._emit("error", f"warm opener TTS failed, will retry on answer: {e}")

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

        And when the prosody reader is on, the text rules are not enough on
        their own: "use organic back channels, but only when the prosody
        actually calls for it, not just as a way to mask latency". A "Right."
        answers a statement that LANDED, which is exactly what the fell
        contour is. A rise is a question whether or not the transcript kept
        the mark, and a held or unreadable contour is somebody mid-thought,
        where the only right noise is none.
        """
        if not self._backchannel:
            return None
        text = heard.strip()
        # The resume path feeds "(they said nothing)" through here, and it
        # passes every text rule below. You do not say "Right." to silence.
        if not text or text == config.WENT_QUIET or text.endswith("?"):
            return None
        if len(text.split()) < 3:
            return None
        # Questions do not always carry a question mark once transcribed.
        first = text.lower().split()[0]
        if first in {"who", "what", "why", "when", "where", "how", "is", "are",
                     "do", "does", "did", "can", "could", "would", "will"}:
            return None
        # A rise is a question, whatever the words look like.
        if self._last_contour == "rose":
            return None
        # With a reader attached, only a landed statement invites the noise.
        if (self.prosody is not None and config.PROSODY_ENABLED
                and self._last_contour != "fell"):
            return None
        if random.random() > config.BACKCHANNEL_CHANCE:
            return None
        return random.choice(self._backchannel)

    def _emit(self, kind: str, text: str) -> None:
        self.on_event(kind, text)

    def announced_themselves(self, greeting: str) -> bool:
        """Did they say who they are, or just say hello?

        Decides which opener to use. "Hello?" needs "is that Waterways
        Plumbing?", because we genuinely do not know we have the right person.
        "Waterways Plumbing, this is Mike" does NOT: asking him to confirm the
        name he just said wastes a turn, sounds like a machine reading a
        script, and is what Mike actually got before he hung up.

        Wrong in the safe direction. Treating a real greeting as an
        announcement costs nothing, because "Hi there, it's Maria" is a
        perfectly normal thing to say to anybody. Treating an announcement as a
        bare hello is the failure that just cost us a call.
        """
        g = (greeting or "").strip().lower()
        if not g:
            return False
        if "this is" in g or "speaking" in g or "how can i help" in g:
            return True
        # Any real word from the business name coming back at us means they
        # led with it. Short words are skipped: "and", "the", "inc" match
        # everything and would make a bare "hello" look like an announcement.
        for word in (self.business_words or ()):
            if word in g:
                return True
        # A bare greeting is one or two words. Anything longer is somebody
        # telling us something, and answering it with a name-check is odd.
        return len(g.split()) >= 4

    def _answerphone(self, result, heard: str | None = None) -> bool:
        """Is this a machine? Sets the outcome and returns True if so.

        Two independent readers, because each covers the other's blind spot.

        Telnyx classifies from the audio on its own leg and is usually right
        within a few seconds, but returns "not_sure" often enough to matter.
        The phrase list reads the transcript, which is slower (we must hear the
        greeting first) but catches exactly the case Telnyx hedges on.

        BOTH fail towards keeping the call. Hanging up on a real plumber
        mid-sentence is a worse outcome than a wasted minute of API time: one
        costs pennies, the other costs the lead and sounds like a broken
        robocall. So "not_sure" is not a machine, and a phrase hit on its own
        is not either.
        """
        if getattr(self.transport, "is_machine", None) and self.transport.is_machine():
            result.outcome = "answering_machine"
            self._emit("amd", "Telnyx says answerphone, hanging up")
            return True
        if not heard:
            return False
        text = heard.lower()
        # Carrier voicemail. Nobody says these, so no length check is needed
        # and applying one just lets short ones through, which is exactly how
        # "your call has been forwarded to voicemail" got filed as a completed
        # conversation.
        sure = next((p for p in config.AMD_PHRASES_CERTAIN if p in text), None)
        if sure:
            result.outcome = "answering_machine"
            self._emit("amd", f"carrier voicemail ({sure!r}), hanging up")
            return True
        hit = next((p for p in config.AMD_PHRASES if p in text), None)
        # A phrase AND a greeting long enough that nobody is waiting for a
        # reply. "Can I take a message" from a receptionist is short and is a
        # question; "please leave your name and number after the tone" is
        # neither. Requiring both is what keeps a human out of this branch.
        if hit and len(text.split()) >= config.AMD_MIN_GREETING_WORDS:
            result.outcome = "answering_machine"
            self._emit("amd", f"answerphone from the greeting ({hit!r}), hanging up")
            return True
        return False

    def _set_stage(self, stage: str, tries: int) -> None:
        """Tell the model which stage it is on. Never fatal.

        The gate is an enhancement on top of speaking, not a prerequisite for
        it, so a brain that does not implement it, or one that throws, must
        degrade to the old behaviour rather than ending the call. Caught by the
        end-to-end test, where a stand-in brain without set_stage took the whole
        call down and the only symptom was "the prospect was never transcribed".
        """
        # Where she got to, kept on the agent so a campaign run can record it
        # without reaching into the call loop's locals. Set before the brain is
        # told, so it is right even when telling the brain fails.
        self.last_stage = stage
        try:
            self.brain.set_stage(stages.brief(stage, tries))
        except Exception as e:
            self._emit("error", f"stage brief not applied: {e}")

    def _play(self, text: str, payload: bytes, so_far=None) -> tuple[str, bool, float]:
        """Play one piece of speech.

        Returns (what they actually heard, cut off?, milliseconds of speech).

        That third value is not a statistic, it is the only evidence anywhere of
        how much of a streamed reply reached the prospect. The streamed path
        cannot pass its text in, because the text does not exist yet when
        playback starts, so it has to reconstruct the heard portion afterwards
        from this. Discarding it is what let a cut-off introduction be recorded,
        and believed by the model, as delivered in full.

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
        # When sound actually started leaving for the far end, which is a few
        # hundred milliseconds after we asked. Timing from the request instead
        # inflates every estimate by the synthesis delay.
        speaking_from = 0.0

        while self.transport.is_speaking():
            chunk = self.transport.read(timeout=0.15)
            if chunk is None:
                continue
            # Measure the grace window from when sound actually started leaving
            # for the far end. With streaming that is ~300ms after we asked, and
            # timing it from the request meant the window was already spent
            # before she made a noise, so the opener was cut off every call.
            began = self.transport.audio_started_at() or started
            speaking_from = began
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
            if config.BARGE_IN_ENABLED and speech_ms >= barge_threshold_ms(
                    elapsed_ms, self.transport.barge_min_ms):
                # `so_far` lets the streamed path hand over the text it has
                # produced up to now, because on that path the sentence does not
                # exist yet when playback begins.
                current = spoken_words(text or (so_far() if so_far else ""))
                if not self._confirm_barge(elapsed_ms, current):
                    # Noise, echo or a murmur, not a person taking the floor.
                    # Reset rather than hold: real speech re-accumulates in a
                    # few hundred ms and by then the transcriber has words to
                    # confirm it with.
                    barge.reset()
                    continue
                # Let the word in flight land before cutting. Stopping the
                # instant we decide chops a syllable in half, which sounds
                # broken rather than polite. Hugo: "you don't stop mid-word, you
                # can stop mid-sentence, but never mid-word." A couple of
                # hundred milliseconds is about one word at speaking pace.
                # Wait exactly long enough to land on the next word boundary.
                time.sleep(_finish_word_ms(current, elapsed_ms) / 1000.0)
                self.transport.stop_speaking()
                self._emit("bargein", "prospect interrupted")
                interrupted = True
                break

        # Measured from the first sound out, not from when we asked to speak.
        speak_ms = ((time.monotonic() - speaking_from) * 1000.0) if speaking_from else 0.0
        if not interrupted:
            return text, False, speak_ms
        return _spoken_prefix(text, speak_ms), True, speak_ms

    def _own_echo(self, text: str) -> bool:
        """Is this her own voice coming back, rather than the prospect?

        Seen live: she finished "Hi, is that Smith Plumbing? ... Have you got a
        minute?" and in the SAME second a turn arrived reading "that." She then
        spent a turn asking him to clarify a word he had never said.

        Draining our own audio buffer does not prevent it, because the
        transcriber has already been fed those bytes and will report them
        whatever we do afterwards. The far end's handset echoes us, most often
        on speakerphone, and there is no way to stop that at the source.

        So it is recognised instead, and the test is deliberately narrow: only a
        very short fragment, only just after she stopped, and only when every
        word in it is one she just said. A genuine interruption is longer than
        three words or contains something new, and either way survives this.
        """
        if not self._last_spoken or not text:
            return False
        if time.monotonic() - self._stopped_at > config.ECHO_WINDOW_S:
            return False
        words = re.sub(r"[^\w\s']", " ", text.lower()).split()
        if not words:
            return False
        mine_raw = " ".join(re.sub(r"[^\w\s']", " ", self._last_spoken.lower()).split())
        theirs = " ".join(words)
        # A LONG echo. Proved on a live call: she said "Brilliant. So you're
        # hearing me work right" and it came straight back as a turn reading
        # "Brilliant. So you're hearing me work, right?", which she then
        # answered. The whole sentence, near verbatim, so the short-fragment
        # test below could never have caught it.
        #
        # The old assumption was that Telnyx sends only the far end and our own
        # voice cannot return. That is wrong: the prospect's handset carries it
        # back, and on a speakerphone it comes back clean enough to transcribe
        # perfectly. Everything tuned on that assumption was tuned wrong.
        if len(words) >= 4 and difflib.SequenceMatcher(
                None, theirs, mine_raw).ratio() >= config.ECHO_SIMILARITY:
            return True
        if len(words) > 3:
            return False
        # NEVER eat a word that is a complete answer on its own. The first
        # version of this tested word overlap alone, so a prospect saying "Yes."
        # was discarded whenever she happened to have said "yes" in her last
        # line. The end-to-end test caught it; on a live call it would have
        # looked like her ignoring the answer she had just asked for.
        if len(words) == 1 and words[0] in _STANDALONE_REPLY:
            return False
        # Contiguous, not scattered. Echo is a fragment of what she said, in
        # the order she said it, not a bag of words that happen to appear.
        return theirs in mine_raw

    def _confirm_barge(self, elapsed_ms: float, current: str) -> bool:
        """Stage two of the interrupt decision: is this a person taking the floor?

        Stage one is the VAD's sustained-speech trigger, and on its own it is a
        kill switch: any noise loud enough for long enough snaps her shut. That
        was tolerable at the full 700ms threshold and is not at the early-yield
        350ms one, so inside the early window the trigger has to be CONFIRMED
        by the live transcriber actually hearing words.

        Three things fail the confirmation, each a real way the kill switch
        fired wrongly:
          - no words at all: a door slam, a cough, a clatter of tools
          - her own current sentence coming back off their handset, which
            _own_echo cannot see because it compares against the PREVIOUS turn
          - a bare agreement murmur ("yeah", "uh huh"): somebody agreeing
            along under her, which is an invitation to keep going, not to stop

        Past the early window, or on a rig with no live transcriber, the
        sustained-speech evidence stands on its own exactly as it always did,
        so a real interruption can never be locked out for long: the VAD keeps
        accumulating and crosses the full threshold regardless.
        """
        if elapsed_ms >= config.BARGE_EARLY_WINDOW_MS:
            return True
        if self.ears is None:
            return True
        fn = getattr(self.ears, "partial_text", None)
        if fn is None:
            return True
        try:
            partial = (fn() or "").strip()
        except Exception:
            return True        # a broken reader must not lock out interruptions
        if not partial:
            return False
        words = re.sub(r"[^\w\s']", " ", partial.lower()).split()
        if not words:
            return False
        if len(words) <= 2 and all(w in _AGREEMENT_MURMURS for w in words):
            return False
        mine = " ".join(re.sub(r"[^\w\s']", " ", (current or "").lower()).split())
        theirs = " ".join(words)
        if mine:
            if len(words) >= 4 and difflib.SequenceMatcher(
                    None, theirs, mine).ratio() >= config.ECHO_SIMILARITY:
                return False
            if len(words) <= 3 and theirs in mine:
                return False
        return True

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
        # Either opener may be the one chosen on the day, so both pre-rendered
        # clips are eligible. Missing this would silently re-render the warm
        # one on answer, putting its generation time back as dead air at the
        # start of the call, which is the exact cost the pre-render exists to
        # avoid.
        payload = None
        if text == straighten(self.opener):
            payload = self._opener_audio
        elif text == straighten(self.opener_warm):
            payload = self._opener_warm_audio
        if payload is None:
            try:
                payload = self.tts.say(text)
            except Exception as e:
                self._emit("error", f"TTS failed: {e}")
                return False

        spoken, interrupted, _ = self._play(text, payload)
        self._settle()

        # Recorded after playback, and only what was delivered. Appending before
        # speaking meant a TTS failure or a barge-in still produced a transcript
        # claiming the whole line, disclosure included, had been spoken.
        words = spoken_words(spoken)
        # The opener is usually a question ("Hi, is that Hugo's Plumbing?"),
        # and a cut can land one word before its mark exactly like a reply.
        self._question_pending = question_was_asked(spoken_words(text), words)
        # WHICH CUES ACTUALLY WENT TO THE VOICE, and where in the line.
        #
        # spoken_words() strips them, and it feeds BOTH the log and the saved
        # transcript, so until now the emotion cues were invisible everywhere.
        # That is the one feature Hugo has spent the most time tuning, and
        # nobody could tell from any record whether she used a single one. I
        # tried to measure it across 456 turns and got zero, which was the
        # stripping, not the truth.
        #
        # Position matters as much as presence: a cue at index 0 is the "light
        # switch at the start of every line" pattern, and one in the middle is
        # the gear-change a person actually makes. Recording where they land is
        # what makes that difference measurable instead of a matter of opinion.
        if words:
            found = [(m.start(), m.group(0)) for m in _CUE_RE.finditer(spoken)]
            if found:
                self._emit("cues", ", ".join(
                    f"{c}@{'start' if i < 3 else 'mid'}" for i, c in found))
        self._last_spoken = words
        self._stopped_at = time.monotonic()
        if words:
            self._emit("ai", words)
            result.turns.append(
                Turn("ai_truncated" if interrupted else "ai", words,
                     time.time() - result.started_at)
            )
        return interrupted

    def _giveup_line(self, result: CallResult):
        """Speak the stage she was sent to after failing to get an answer,
        but LISTEN FIRST when her own last line was a question.

        The immediate speak exists for a reason: the give-up stages are the
        ones where she does the talking, and waiting silently there once ran
        seventeen seconds of dead air. But on a live call the try that burned
        the stage was itself a question, "tomorrow morning, or Thursday
        afternoon?", and the immediate speak had her asking again three
        seconds later with nothing heard in between. A question in the air
        buys the prospect one full listen; a real answer is what gets replied
        to, and only their silence hands the turn back to her.
        """
        handoff = config.WENT_QUIET
        if self._last_spoken.rstrip().endswith("?") or self._question_pending:
            self._emit("waiting",
                       "gave up the stage with a question in the air, listening first")
            got = (self._listen_streaming(result)
                   if self.ears is not None else self._listen(result))
            if got:
                handoff = got
        return self._say_live(handoff, result)

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
        # ALWAYS, not only when a backchannel played. The prompt bans a bare
        # "Right"/"Okay" opener outright, and it kept coming back on turns where
        # no acknowledgement had played, because the stripper was gated on one
        # having played. "Right. You're talking to me now" on a live call.
        # acked does NOT gate the strip, only what happens when the strip
        # leaves nothing: if the backchannel already said "Right.", silence is
        # right; if it did not, saying the original beats saying nothing.
        raw = _drop_leading_ack(raw, acked=ack is not None)
        # The banned register and the clause cap, in code rather than in the
        # prompt. Upstream of _clip_reply so `spoken` records what actually
        # reached the voice. See bridge/copy_guard.py for why both rules had to
        # stop being suggestions.
        raw = copy_guard.guard(raw, on_event=self._emit)
        tokens = clean_cues(_clip_reply(raw, spoken))
        # The occasional trip, downstream of _clip_reply ON PURPOSE: `spoken`
        # feeds the transcript and the model's own memory, and a model shown
        # its own stutter starts imitating it. The voice performs the trip;
        # the record keeps the clean line, the same deal the cues get.
        if config.DISFLUENCY_ENABLED:
            tokens = self._disfluencer.feed(tokens)

        if ack is not None:
            # Plays over the model's first tokens, so it costs nothing.
            self._emit("ai", ack[0])
            self._play(*ack)

        chunks = self.voice_stream.stream_tokens(tokens)
        _, interrupted, speak_ms = self._play(
            "", chunks, so_far=lambda: spoken_words("".join(spoken)))
        self._settle()

        full = "".join(written)
        slot = booked_slot(full)
        if slot and not result.booked and booking_allowed(heard):
            result.booked = slot
            self._emit("booked", slot)
        elif slot and not result.booked:
            self._emit("guard", f"[BOOK: {slot}] refused, it answered silence")
        # `spoken` is what was handed to the voice, which on an interruption is
        # NOT what came out of the phone. Fish is sent the whole reply in one go
        # and streams the audio afterwards, so a barge-in two seconds in means
        # they heard about two seconds of it and nothing more.
        #
        # Left uncorrected this was the bug Hugo caught: a 21 word introduction
        # was cut after roughly nine words, recorded in full, and the model,
        # believing it had already said why it was ringing, went straight to
        # "have you got a minute?" about something the prospect had never heard.
        full_voice = spoken_words(_strip_marker("".join(spoken)))
        heard = full_voice
        if interrupted:
            # The trip added audio the char-per-second estimate knows nothing
            # about. Uncorrected, a barge on a tripped turn credited the
            # prospect with roughly a word they never heard.
            if config.DISFLUENCY_ENABLED:
                speak_ms = max(0.0, speak_ms - (
                    self._disfluencer.last_trip_chars / chars_per_second() * 1000.0))
            heard = _spoken_prefix(heard, speak_ms)
        words = heard
        # Whether a question was ASKED, judged against the reply she was
        # saying rather than the fragment that survived the cut. The waiting
        # rule in call() reads this: a question clipped one word before its
        # mark still deserves a silence that means "they are thinking".
        self._question_pending = question_was_asked(full_voice, words)
        # Correct the model's own record to what actually left the phone. Left
        # uncorrected it believes it delivered the half of the reply that was
        # cut off, so it never says it, and the call quietly loses the thread.
        self.brain.amend_last(words)
        # Only once it has actually been delivered in full. A disclosure the
        # prospect talked over is one they did not hear, and that one does need
        # saying again.
        if words and not interrupted and _DISCLOSED_RE.search(words):
            self.brain.note_disclosed()
        elif words and not interrupted and config.REQUIRE_DISCLOSURE:
            # Only when a campaign actually requires proactive disclosure. This
            # used to run unconditionally, which meant the code appended "say
            # you are an AI in your VERY NEXT reply" and overrode a prompt that
            # had been changed to do the opposite. She announced it unprompted
            # on every call while the prompt said not to, and the prompt looked
            # like the thing that was broken.
            self.brain.chase_disclosure()
        # Tell the transcriber what she just said. Their docs: biggest impact on
        # short replies ("yes", "about twenty", a name), which on a sales call
        # is most of them.
        self._last_spoken = words
        self._stopped_at = time.monotonic()
        if words and self.ears is not None:
            self.ears.set_agent_context(words)
        if words:
            self._emit("ai", words)
            result.turns.append(
                Turn("ai_truncated" if interrupted else "ai", words,
                     time.time() - result.started_at)
            )
        return _has_marker(full), interrupted, chosen_exit(full)

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
        # This path plays whole sentences, so a question either played in full
        # (and _last_spoken ends with its mark) or was dropped entirely. The
        # flag must not carry over from a previous _say_live turn.
        self._question_pending = False

        # Mutable so the closure can flip it; only the first sentence of a turn
        # can carry a leading acknowledgement.
        first_sentence = [True]

        def produce():
            try:
                for sentence, _is_final in sentences:
                    if stop_producing.is_set():
                        break
                    if _has_marker(sentence):
                        saw_end.set()
                    # THE CUE ALLOWLIST HAS TO RUN HERE TOO.
                    #
                    # This path is taken whenever the Fish websocket fails to
                    # open, and it only ever stripped the [END] marker. So a
                    # free-form "[chuckling]" went straight to the voice and
                    # the laugh Hugo reported twice was back, and on a provider
                    # that does not perform cues at all the word was read out
                    # loud. The guarantee has to hold on every route to the
                    # voice, not just the usual one.
                    # Same two rules as the live path. This route is taken
                    # whenever the Fish socket fails to open, and a guarantee
                    # that only holds on the fast path is not a guarantee.
                    guarded, notes = copy_guard.swap(_strip_marker(sentence))
                    for note in notes:
                        self._emit("guard", note)
                    guarded = copy_guard.trim_list(guarded, self._emit)
                    clean = "".join(clean_cues([guarded])).strip()
                    # Emptiness checked AFTER the filter: a sentence that was
                    # nothing but a refused cue is now empty and must be
                    # skipped, not sent as a bare space.
                    if not clean:
                        continue
                    # And the banned opener, for the same reason. Only the
                    # first sentence can carry one. Unlike _drop_leading_ack
                    # this consumes whole sentences, so if stripping empties it
                    # entirely, keep the original rather than fall silent.
                    if first_sentence[0]:
                        first_sentence[0] = False
                        stripped = _strip_ack(clean)
                        if spoken_words(stripped).strip():
                            clean = stripped
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
            said, interrupted, _ = self._play(text, payload)
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

    def _listen_streaming(self, result: CallResult, timeout: float | None = None) -> str:
        """Wait for AssemblyAI to say a turn finished.

        There is no VAD here and no end-of-turn wait, because AssemblyAI is
        already listening continuously and decides for itself when somebody has
        stopped. The text exists the moment they finish, which is the whole
        point: the old path spent 250ms waiting for silence and another 478ms
        uploading, both of them AFTER the prospect had finished speaking.

        Audio is pumped over by the transport's reader, not from here.
        """
        # Cleared on the way in: the contour belongs to ONE turn, and a "fell"
        # left over from two turns ago must not authorise a "Right." after a
        # stretch of silence.
        self._last_contour = None
        deadline = time.time() + (config.AAI_TURN_TIMEOUT_S if timeout is None else timeout)
        said_why = False
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
                # How long to let a pause run before treating it as the end of
                # a turn. The long wait exists only because silence alone cannot
                # tell a finished sentence from somebody thinking. When the
                # prosody reader CAN tell, because the pitch fell away or rose
                # into a question, there is nothing left to wait for.
                wait = config.SETTLED_PARTIAL_S
                floor = config.SETTLED_PARTIAL_MIN_WORDS
                if self.prosody is not None and config.PROSODY_ENABLED:
                    # Prosody hears the end of a SENTENCE, which is not the
                    # same as the end of a TURN. "I have a problem." falls
                    # away exactly like a finished thought, and then they
                    # carry straight on with "there's something leaking".
                    # That happened on a live call and she answered the
                    # first half, so the fast path is deliberately not as
                    # fast as the signal alone would allow, and it asks for
                    # more words before it will act. And a HELD reading goes
                    # the other way entirely: see settle_plan.
                    verdict, why = self.prosody.verdict()
                    wait, floor = settle_plan(verdict)
                    if not said_why and verdict in ("fell", "rose"):
                        said_why = True
                        self._emit("prosody", f"{verdict}: {why}, answering "
                                              f"after {wait * 1000:.0f}ms")
                    elif not said_why and verdict == "held":
                        said_why = True
                        self._emit("prosody", f"held: {why}, waiting out "
                                              f"the pause")
                early = self.ears.settled_partial(wait, min_words=floor)
                if early and not sounds_unfinished(early):
                    self.ears.accept(early)   # so its final is not answered twice
                    text = early
                else:
                    continue
            if not text:
                return ""         # socket closed
            if self._own_echo(text):
                self._emit("echo", f"ignored own voice coming back: {text!r}")
                continue
            if is_thinking_noise(text):
                # They are working out what to say. Interrupting that with a
                # rephrased question is how she asked the same thing three
                # times in ten seconds on a live call.
                self._emit("thinking", f"{text!r}, giving them a moment")
                continue
            # They stopped making noise, but did they stop talking? If the
            # thought is obviously unfinished, give them a moment and join it up
            # rather than answering half a sentence.
            if sounds_unfinished(text):
                more = self.ears.next_turn(timeout=config.UNFINISHED_WAIT_S)
                if more:
                    text = f"{text} {more}".strip()
            self._heard_at = time.monotonic()
            # Forget this sentence's contour. Left in place, the fall at the end
            # of THIS turn would still be sitting there when the next one is
            # judged, and every following turn would be answered early on stale
            # evidence. What it DID is kept first: the backchannel gate needs
            # to know whether this turn landed as a statement, and by the time
            # it asks, the reader has been wiped.
            if self.prosody is not None:
                self._last_contour, _ = self.prosody.verdict()
                self.prosody.reset()
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
                deadline = time.time() + config.WAIT_FOR_HELLO_S
                hard = time.time() + config.WAIT_FOR_HELLO_MAX_S
                while time.time() < deadline:
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
                    # They have started. Do not open over the top of them: give
                    # them room to finish, up to the hard ceiling. Without this
                    # the wait expires mid-greeting and she and the plumber
                    # speak at the same instant, which is what Stroh Bros got.
                    if getattr(self.ears, "partial_text", None) and self.ears.partial_text():
                        deadline = min(hard, time.time() + config.WAIT_FOR_HELLO_S)
            if greeting:
                self._emit("them", greeting)
                result.turns.append(Turn("them", greeting, time.time() - result.started_at))
                self._heard_at = time.monotonic()

            # Pick the opener AFTER hearing how they answered. A name-check is
            # useful against "Hello?" and insulting against "Waterways
            # Plumbing, this is Mike".
            opening = self.opener
            if self.announced_themselves(greeting):
                opening = self.opener_warm
                self._emit("opener", "they announced themselves, skipping the name check")
            cut_off = self._say(opening, result)
            # The model has to know what it already said, or it introduces itself
            # again on the next turn. If the opener was cut short it also has to
            # know the AI disclosure may not have landed, because saying it is
            # required by Anthropic's and ElevenLabs' policies, not optional.
            # The one she ACTUALLY said. Telling the brain she opened with the
            # name check when she did not means she introduces herself twice.
            self.brain.note_opening(opening, truncated=cut_off)

            quiet_rounds = 0
            # Set when the last thing she said was cut short, which changes how
            # long she is willing to wait before picking the thread back up.
            was_cut = False
            listen_for: float | None = None
            # THE GATE. This number lives here, in code, and the model cannot
            # change it. It may ask to move on with [NEXT] and it advances only
            # when this agrees. See bridge/stages.py.
            stage = stages.START
            tries = 0
            self._set_stage(stage, tries)
            while time.time() - result.started_at < config.MAX_CALL_SECONDS:
                if not self.transport.is_live():
                    result.outcome = "far_end_hungup"
                    break
                # Telnyx's own verdict, which arrives a few seconds in while
                # the opener is still playing. Checked at the TOP of every
                # turn so the pitch stops at the end of the current sentence
                # rather than running the full minute at a machine.
                if self._answerphone(result):
                    break
                heard = (self._listen_streaming(result, listen_for)
                         if self.ears is not None else self._listen(result))
                # The backstop, for a machine Telnyx was not sure about. Only
                # readable once we have heard the greeting, hence the second
                # check here rather than one at the top.
                if heard and self._answerphone(result, heard):
                    break
                if (not heard and was_cut
                        and (self._last_spoken.rstrip().endswith("?")
                             or self._question_pending)):
                    # She asked something and was cut short. Silence after a
                    # question is a person thinking, not a stalemate, so the
                    # resume shortcut must not fire here: it would mean asking
                    # again before they had a chance to answer once.
                    # _question_pending covers the cut that lands one word
                    # BEFORE the mark: the delivered text has no "?" but the
                    # question was asked in every sense that matters, and on a
                    # live call the old test missed it and she chased a
                    # thinking man with a follow-up.
                    self._emit("waiting", "asked a question, so waiting properly")
                    was_cut = False
                    listen_for = None
                    quiet_rounds += 1
                    if quiet_rounds >= 2:
                        result.outcome = "went_quiet"
                        break
                    continue
                if not heard and was_cut:
                    # They cut in and then said nothing. Do not sit here: carry
                    # on from where she was stopped, which is what the prompt
                    # tells her to do with this marker.
                    self._emit("resume", "cut off, then silence, so carrying on")
                    # Restart the clock. Otherwise the gap is measured from
                    # their last turn, which was before she spoke AND before
                    # she was cut off, and the log shows a lag nobody waited
                    # through: 11643ms on a live call for what was really two
                    # seconds. A misleading number is worse than none, because
                    # it sends the next hour of tuning after a phantom.
                    self._heard_at = time.monotonic()
                    heard = config.WENT_QUIET
                    was_cut = False
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
                        ends, was_cut, went = self._say_live(heard, result)
                    else:
                        ends, was_cut = self._say_stream(
                            self.brain.stream_sentences(heard), result
                        )
                        went = None
                    listen_for = config.RESUME_AFTER_CUT_S if was_cut else None

                    # She picks the exit; the map decides where it leads. An
                    # exit she invented, or one belonging to another stage,
                    # leaves her exactly where she was.
                    nxt, finished = stages.route(stage, went)
                    if finished:
                        result.outcome = "completed"
                        ends = True
                    elif nxt != stage:
                        stage, tries = nxt, 0
                        self._emit("stage", stages.STAGES[stage].name)
                    else:
                        tries += 1
                        if tries >= config.STAGE_MAX_TRIES:
                            # Cannot get an answer. This does NOT continue down
                            # the road: somebody who will not answer the same
                            # question twice is telling you something, and the
                            # old code marched on to the close regardless.
                            nxt, finished = stages.give_up(stage)
                            if finished or not nxt:
                                result.outcome = "no_answer_given"
                                ends = True
                            else:
                                stage, tries = nxt, 0
                                self._emit("stage",
                                           f"{stages.STAGES[stage].name} "
                                           f"(could not get an answer)")
                                # And SPEAK it. The stages she is sent to when
                                # she cannot get an answer are the ones where
                                # SHE does the talking: leave it with them, take
                                # the no, arrange a callback. Waiting for input
                                # there means both sides sit in silence until
                                # the call dies, which is exactly what happened:
                                # she gave up on getting a time, moved to
                                # "leaving it with them", and then said nothing
                                # for seventeen seconds.
                                self._set_stage(stage, tries)
                                try:
                                    ends, was_cut, went = self._giveup_line(result)
                                    nxt2, fin2 = stages.route(stage, went)
                                    if fin2:
                                        result.outcome = "completed"
                                        ends = True
                                    elif nxt2 != stage:
                                        stage = nxt2
                                except Exception as e:
                                    self._emit("error", f"closing line failed: {e}")
                    self._set_stage(stage, tries)
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
            # Let her finish, and then let the moment land, before the line
            # goes dead. Hugo: "when she finished the call, don't hang up
            # immediately, no?"
            #
            # Two separate things. The DRAIN waits for audio already handed to
            # Telnyx to actually play, because the loop reaches here while her
            # closing sentence is still going out and hanging up mid-word is
            # how "Perfect, ten o'clock tomorrow" became "Perfect, ten o'clo".
            # The PAUSE then holds the line a beat longer, because a person
            # says "bye" into that gap and a call that dies the instant she
            # stops speaking feels like being cut off.
            #
            # Skipped entirely when THEY hung up on US: there is no line left
            # to be polite on, and waiting would just delay the next call.
            try:
                if self.transport.is_live():
                    drain = time.monotonic() + config.HANGUP_DRAIN_MAX_S
                    while (self.transport.is_speaking()
                           and self.transport.is_live()
                           and time.monotonic() < drain):
                        time.sleep(0.1)
                    if self.transport.is_live():
                        time.sleep(config.HANGUP_PAUSE_S)
            except Exception as e:
                self._emit("error", f"drain before hangup failed: {e}")
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

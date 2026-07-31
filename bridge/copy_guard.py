"""The last gate before the voice. Hard rules, not prompt suggestions.

Hugo, 2026-07-29, after the fourth prompt-only attempt at the same defect:
"we've hit the ceiling with prompting. Trying to manage a word budget or a
blacklist within the system prompt is just a game of whack-a-mole. The model
finds a loophole, like those long comma-heavy sentences, and the illusion
breaks. We need to stop asking the model to police itself. Move that blacklist
into a dedicated filtering layer in the code."

He is describing something the repo already learned twice. The no-long-dash rule
is enforced by a test rather than remembered, and the emotion cues are enforced
by an allowlist in clean_cues rather than by the six the prompt suggests. Both
were prompt rules first, and both leaked until they were code.

This module is the same move for the two things still leaking.

--- 1. The banned register -------------------------------------------------

Words nobody says down a phone. Swapped, not deleted, so the sentence still
scans: "furthermore" becomes "also", not a hole where a connective was.

Note honestly what the evidence says. Counted over all 89 AI turns from the US
plumber campaign, exactly two of these ever fired ("basically", "solution"). So
this list is a guard rail, not a repair: it is here to stop the register drifting
the day somebody edits the prompt, which is a thing that has now happened four
times. Every substitution is reported through on_event, so if the list turns out
to be firing constantly on live calls we will see it in the log rather than
guess.

--- 2. The list run --------------------------------------------------------

This is the one that is actually broken, and it is the reason the module exists.

    "So I answer phones while you're out on a job. Takes the calls you'd
     otherwise miss, books jobs straight in, texts people back, basically
     covers your line when you can't."

Four items, 29 words, no question at the end, on a call Hugo asked me to place
to check the previous fix. It is a brochure, and the prospect answered "Okay."
and nothing else, which is what people say when they have been read at.

Neither existing guard could catch it. MAX_SPOKEN_WORDS cuts at the next full
stop past 28 words, and a list has no full stops in it, so the cap arrived after
the last item. Sentence counting sees one sentence, because a comma run IS one
sentence. config.py already admits this in as many words: "a cap can only ever
chop a monologue, not prevent one".

So the rule counts CLAUSES, which is the unit the defect is actually built from.
Measured over the same 89 turns: 18 had two or more commas in a turn, 9 had three
or more, and 5 of those asked nothing at all.

The cut has to be careful, because most commas are not list commas. "Hey there,
sorry to catch you cold like this, I'm Maria, and I'm actually calling because
I'm looking for work" has three commas and is a good opener. Three conditions,
all required, each one paid for by a line in the real transcripts:

  - at least LIST_MIN_WORDS words in the sentence already, which spares
    "Yeah, no worries, I'll be quick." and "Okay, got it, so what's your setup?"
  - the clause that just ENDED has to look like a bare list item, meaning it
    does not open with a subject, a conjunction or an interjection. This is the
    load bearing one. Real list items in her copy are subject-less predicates
    ("book jobs in", "take messages", "chase people up"); the false positives
    are not ("sorry to catch you cold", "I don't take holidays", "and I figured
    I'd just ask"). It is a crude proxy for parallelism.
  - and the clause must not be a NAME. Replayed over the corpus the first
    version of this rule cut three openers, turning "Hi, is that Master Drains
    and Plumbing, Inc., Littleton?" into "Hi, is that Master Drains and
    Plumbing." A company name is the one comma-heavy proper noun on these
    calls, and getting it wrong is the first thing the prospect hears. Two
    tests catch it: a mid-sentence capital is a name, and a clause opening on
    an auxiliary ("is that...") is a question, not an item.

Replayed over all 91 AI turns the campaign has produced, the finished rule
fires on 3 and every one of the 3 is a features list. It changes nothing else.
  - the comma must be a real comma: not inside a cue tag, not inside "1,000".

And when it fires it SKIPS TO THE NEXT SENTENCE rather than ending the turn.
That distinction is the whole difference between fixing this and causing the bug
we spent this morning fixing. One real turn was

    "I answer calls, book jobs in, chase people up. Never miss anything, never
     take a day off. How does that land?"

Ending the turn at the second comma would have deleted "How does that land?",
which is the closing question, which is the exact failure mode that has already
killed calls twice. Dropping only the rest of the offending sentence leaves the
question alone.
"""
from __future__ import annotations

import re

from . import config

_CUE = re.compile(r"\[[^\]]*\]")


def _spoken(text: str) -> str:
    """The text with cue tags removed. A tag is not a word and is not spoken."""
    return re.sub(r"\s+", " ", _CUE.sub(" ", text)).strip()


# --- 1. The banned register -------------------------------------------------

# (phrase, replacement). Plain lowercase literals rather than patterns, so the
# same string can be used both to match and to decide how much of the stream has
# to be held back before it is safe to emit. A replacement of "" deletes.
#
# NOTHING HERE MAY TOUCH THE AI DISCLOSURE. _DISCLOSED_RE in agent.py watches for
# "A.I." and "artificial intelligence" to decide whether she has declared
# herself, and rewriting either of those would make the code believe a
# disclosure happened that did not. That is a compliance record, not copy.
SWAPS: tuple[tuple[str, str], ...] = (
    # Essay connectives. Written English only; nobody joins two spoken
    # sentences with "furthermore". Named by Hugo directly.
    ("furthermore", "also"),
    ("moreover", "and"),
    ("additionally", "also"),
    ("consequently", "so"),
    ("therefore", "so"),
    ("nevertheless", "still"),
    ("nonetheless", "still"),
    # Wrap-up phrases. She is on a phone call, not reading out a report, and
    # every one of these announces a summary that the word cap then cuts off
    # halfway through.
    ("to summarise", ""),
    ("to summarize", ""),
    ("in summary", ""),
    ("in conclusion", ""),
    ("to reiterate", ""),
    # Call-centre register. This is the specific voice the prompt spends three
    # paragraphs telling her not to use.
    ("i would be happy to", "I can"),
    ("i'd be happy to", "I can"),
    ("i would be delighted to", "I can"),
    ("please do not hesitate to", "just"),
    ("do not hesitate to", "just"),
    ("don't hesitate to", "just"),
    ("feel free to", "just"),
    ("at your earliest convenience", "when you can"),
    ("how may i assist you", "how can I help"),
    ("is there anything else i can assist you with", "anything else"),
    ("assist you with", "help you with"),
    ("assist you", "help you"),
    ("provide you with", "give you"),
    ("apologies for any inconvenience", "sorry about that"),
    # Consultancy words. A plumber does not buy a solution.
    ("leverage", "use"),
    ("utilise", "use"),
    ("utilize", "use"),
    ("facilitate", "help"),
    ("commence", "start"),
    ("prior to", "before"),
    ("in order to", "to"),
    ("approximately", "about"),
    ("touch base", "catch up"),
    ("circle back", "come back to you"),
    # Was "ring", which is itself the register the block below removes.
    ("reach out to", "call"),
    # The British register, on calls to US trades. The prompt bans every one of
    # these in as many words and they leaked anyway: "at the minute" reached
    # Hugo on a live call on 2026-07-30, "brilliant" repeatedly before that.
    # "It is the fastest way to sound like a foreign call centre, which is
    # exactly what they are braced for." Same rule as the rest of this file:
    # stop asking the model to police itself. If a UK campaign ever runs, this
    # block becomes per-campaign config; today every call is American.
    ("brilliant", "great"),
    ("at the minute", "right now"),
    ("hiya", "hey"),
    ("quid", "bucks"),
    ("fortnight", "two weeks"),
    ("straight away", "right away"),
    ("give you a ring", "give you a call"),
    # Catches "ring you back" too: this runs first and leaves nothing for a
    # longer form to match.
    ("ring you", "call you"),
    # Laughter written as words. The cue allowlist stopped [chuckling], and
    # Fish performs "Haha" in the text just as loudly, so the laugh's last
    # door is closed here. Longer forms first, so "hahaha" is not left as
    # "ha" by the shorter pattern eating its middle.
    ("hahaha", ""),
    ("ha ha ha", ""),
    ("haha", ""),
    ("ha ha", ""),
    ("hehehe", ""),
    ("hehe", ""),
    # THE FRAME. She placed this call, and under a confusing input the model
    # answers as if she had received one: "Sorry, who's asking?" to a live
    # prospect on 2026-07-31, which is a receptionist taking a call, not
    # somebody who dialled it. The question mark is inside the pattern so the
    # replacement lands as a statement rather than a rising fragment, and the
    # longer forms come first so they win.
    ("can i ask who's calling?", "it's Maria, I called you a minute ago."),
    ("can i ask who's calling", "it's Maria, I called you a minute ago"),
    ("who's asking?", "it's Maria, I called you a minute ago."),
    ("who is asking?", "it's Maria, I called you a minute ago."),
    ("who's calling?", "it's Maria, I called you a minute ago."),
    ("who is calling, please?", "it's Maria, I called you a minute ago."),
    ("who is calling?", "it's Maria, I called you a minute ago."),
    ("who's asking", "it's Maria, I called you a minute ago"),
    ("who is asking", "it's Maria, I called you a minute ago"),
    ("who's calling", "it's Maria, I called you a minute ago"),
    ("who is calling", "it's Maria, I called you a minute ago"),
    # Hugo, 2026-07-31: "i dont like the hey". It came out of the prompt's
    # own American-register list, which is fixed too.
    ("hey", "hi"),
    # Profanity. Never yet seen in a transcript, and the day the model writes
    # one must not be the day a prospect hears it. Deletions, not euphemisms:
    # "that's fucking great" reads fine as "that's great".
    ("fucking", ""),
    ("fucked", ""),
    ("fuck", ""),
    ("bullshit", ""),
    ("goddamn", ""),
    ("bitch", ""),
)


def _pattern(phrase: str) -> re.Pattern[str]:
    """Whole-words-only match, tolerant of the spacing the model actually writes."""
    body = r"\s+".join(re.escape(w) for w in phrase.split())
    lead = r"\b" if phrase[:1].isalnum() else ""
    tail = r"\b" if phrase[-1:].isalnum() else ""
    return re.compile(lead + body + tail, re.IGNORECASE)


_COMPILED: tuple[tuple[re.Pattern[str], str, str], ...] = tuple(
    (_pattern(p), r, p) for p, r in SWAPS
)
# How far back a phrase can reach, so the streaming side knows how much text is
# not yet safe to release.
_MAX_PHRASE = max(len(p) for p, _ in SWAPS)
_TIDY = re.compile(r"\s+([,.!?;:])")


def swap(text: str) -> tuple[str, list[str]]:
    """Rewrite every banned phrase. Returns (text, what changed).

    Case is carried across: a phrase that opened a sentence gets a replacement
    that opens a sentence, or the swap would leave her mid-line lowercase and
    Fish reads that as a continuation.
    """
    changed: list[str] = []
    out = text
    for pattern, replacement, phrase in _COMPILED:
        def sub(m: re.Match[str]) -> str:
            hit = m.group(0)
            new = replacement
            if new and hit[:1].isupper():
                new = new[:1].upper() + new[1:]
            changed.append(f"{phrase} -> {new or '(cut)'}")
            return new

        out = pattern.sub(sub, out)
    if changed:
        # A deletion leaves a double space, or a space in front of the comma
        # that followed the phrase. Both are audible: Fish reads punctuation.
        out = _TIDY.sub(r"\1", re.sub(r"[^\S\n]{2,}", " ", out))
    return out, changed


def _safe_split(buf: str) -> tuple[str, str]:
    """Split into (safe to emit now, hold back).

    Held back is any trailing run that could still grow into a banned phrase.
    In ordinary text that is a character or two, so this costs no measurable
    latency: "Hi ther" is held only because "therefore" exists.
    """
    lowest = len(buf)
    start = max(0, len(buf) - _MAX_PHRASE)
    for k in range(start, len(buf)):
        if k and buf[k - 1].isalnum():
            continue                        # not on a word boundary
        tail = buf[k:].lower()
        if not tail:
            continue
        if any(p.startswith(tail) for p, _ in SWAPS):
            lowest = k
            break
    return buf[:lowest], buf[lowest:]


# --- 2. The list run --------------------------------------------------------

# A clause opening with one of these is not a list item, it is a sentence
# carrying on. Subjects, conjunctions, subordinators and the interjections she
# actually opens with. Every entry was put here by a real turn that would
# otherwise have been cut in the wrong place.
_NOT_A_LIST_ITEM = frozenset({
    "i", "i'm", "im", "i've", "ive", "i'll", "ill", "i'd", "id",
    "it", "it's", "its", "you", "you're", "youre", "you've", "youve",
    "we", "we're", "were", "we've", "they", "they're", "he", "he's",
    "she", "she's", "that", "that's", "thats", "this", "there", "there's",
    "these", "those", "my", "your", "our",
    "and", "or", "but", "so", "if", "when", "while", "because", "since",
    "though", "although", "unless", "which", "who", "what", "where", "how",
    "why", "then", "plus", "also",
    # Auxiliaries and the copula. A clause opening on one of these is a
    # question or a predicate carrying on, never an item in a list. Without
    # these the opener cut "Hi, is that Master Drains and Plumbing, Inc.,
    # Littleton?" down to "Hi, is that Master Drains and Plumbing.", which is
    # the company's name said wrong on the first line of the call.
    "is", "are", "am", "was", "were", "be", "been", "being",
    "do", "does", "did", "have", "has", "had",
    "can", "could", "will", "would", "shall", "should", "may", "might", "must",
    "sorry", "look", "right", "okay", "ok", "yeah", "yep", "no", "well",
    "actually", "honestly", "anyway", "thanks", "cheers", "just", "got",
    "basically", "obviously", "listen", "mate",
})


def _is_list_item(clause: str) -> bool:
    """Does this clause read as a bare item in a list?

    A crude parallelism proxy: real items in her copy are subject-less
    predicates, so the test is what the clause opens with.
    """
    words = _spoken(clause).split()
    if not words:
        return False
    lead = words[0].strip(".,!?;:'\"")
    if not lead:
        return False
    # A capital in the MIDDLE of a sentence is a proper noun, and the only
    # comma-separated proper nouns on these calls are company names: "Inc.",
    # "LLC", "Plumber Queens Village NY (Camera Inspection". Her real list
    # items are all lower case, because they are predicates rather than names.
    # This clause has already had a comma in front of it, so it can never be
    # the sentence-initial one that is capitalised for ordinary reasons.
    if lead[0].isupper():
        return False
    return lead.lower() not in _NOT_A_LIST_ITEM


class _ListCutter:
    """Streaming state machine that ends a sentence once it turns into a list.

    Fed text in whatever size chunks arrive, yields the text that survives.
    Kept as a class because the live path is a token stream and the whole point
    is that the decision is made without waiting for the reply to finish.
    """

    def __init__(self, on_event=None):
        self.on_event = on_event or (lambda kind, text: None)
        self._reset_sentence()
        self.skipping = False
        self.depth = 0                      # inside a [cue] or [BOOK: ...]

    def _reset_sentence(self) -> None:
        self.commas = 0
        self.words = 0
        self.clause: list[str] = []         # the clause being read right now

    def feed(self, text: str) -> str:
        out: list[str] = []
        for i, ch in enumerate(text):
            if ch == "[":
                self.depth += 1
            elif ch == "]" and self.depth:
                self.depth -= 1

            if self.skipping:
                # Swallow the rest of the offending sentence, then pick up
                # again at the next one. The turn is NOT ended: a closing
                # question in a later sentence has to survive.
                if ch in ".!?" and not self.depth:
                    self.skipping = False
                    self._reset_sentence()
                continue

            if self.depth or ch == "]":
                out.append(ch)
                continue

            if ch in ".!?":
                out.append(ch)
                self._reset_sentence()
                continue

            if ch == ",":
                nxt = text[i + 1] if i + 1 < len(text) else " "
                prev = self.clause[-1] if self.clause else ""
                # "1,000" is not a clause boundary, and neither is a comma with
                # no word in front of it.
                if not (prev.isalpha() and not nxt.isdigit()):
                    out.append(ch)
                    continue
                self.commas += 1
                clause = "".join(self.clause).strip()
                self.words += len(_spoken(clause).split())
                self.clause = []
                if (
                    self.commas >= config.LIST_MAX_CLAUSES
                    and self.words >= config.LIST_MIN_WORDS
                    and _is_list_item(clause)
                ):
                    out.append(".")
                    self.skipping = True
                    self.on_event(
                        "guard",
                        f"list cut after {self.commas} clauses: "
                        f"...{clause[-40:]},<dropped>",
                    )
                    continue
                out.append(ch)
                continue

            self.clause.append(ch)
            out.append(ch)
        return "".join(out)


def trim_list(text: str, on_event=None) -> str:
    """Whole-string version, for the paths that already have a full sentence."""
    return _ListCutter(on_event).feed(text)


# --- 3. Stage-direction narration -------------------------------------------

# The fourth-wall break, heard live on 2026-07-31: "I need to start this call
# from the beginning. Let me ring them fresh. --- Hi, is that Hugo's
# Plumbing?", spoken in full to a live prospect after a garbled input
# convinced the model the conversation state was broken. Nothing in the
# prompt or the stage briefs contains that language: the model invents it, so
# no prompt edit can remove it, and the guard lives here instead.
#
# The tell is register, not vocabulary: she talks ABOUT the call ("this
# call", "from the beginning"), or about the prospect in the THIRD person
# ("ring them fresh") when the prospect is the only other party on the line.
# Second-person speech ("I'll call you back") is untouched. From the first
# marker the REST OF THE REPLY is swallowed: a model narrating has lost the
# plot for the whole turn, and half a narration is not better than none.
# "let me try" is deliberately absent: "let me try that again" is a
# legitimate recovery line to a confused prospect.
_NARRATION = re.compile(
    r"\b(start (this|the) call|from the beginning|from the top"
    r"|let me (ring|call|dial|redial|restart|start)"
    r"|(ring|call|dial) (them|him|her)\b"
    r"|start (over|again|afresh|fresh))\b",
    re.IGNORECASE,
)
# Long enough to hold the longest marker across a chunk boundary.
_NARRATION_TAIL = 24


def strip_narration(text: str) -> tuple[str, list[str]]:
    """Cut a reply at its first stage-direction marker. (text, what happened)."""
    m = _NARRATION.search(text)
    if not m:
        return text, []
    return (text[:m.start()].rstrip(),
            [f"narration cut: {text[m.start():m.start() + 40]!r}..."])


class _NarrationCutter:
    """The streaming form: holds back a short tail so a marker split across
    chunks is still seen, and swallows everything once one is."""

    def __init__(self, on_event=None):
        self.on_event = on_event or (lambda kind, text: None)
        self.dead = False
        self.tail = ""

    def feed(self, piece: str) -> str:
        if self.dead:
            return ""
        text = self.tail + piece
        m = _NARRATION.search(text)
        if m:
            self.dead = True
            self.tail = ""
            self.on_event(
                "guard", f"narration cut: {text[m.start():m.start() + 40]!r}...")
            return text[:m.start()].rstrip()
        self.tail = text[-_NARRATION_TAIL:]
        return text[:-_NARRATION_TAIL] if len(text) > _NARRATION_TAIL else ""

    def flush(self) -> str:
        out, self.tail = ("" if self.dead else self.tail), ""
        return out


# --- The layer itself -------------------------------------------------------


def guard(tokens, on_event=None):
    """Every rule in this module, over a live token stream.

    Sits UPSTREAM of _clip_reply on purpose, so that what lands in `spoken`,
    and therefore in the transcript and in what the model is told it said, is
    the text that actually reached the voice. Putting it downstream would leave
    the transcript claiming the words she was stopped from saying, which is the
    same lie the truncation handling already exists to prevent.
    """
    emit = on_event or (lambda kind, text: None)
    cutter = _ListCutter(emit)
    narr = _NarrationCutter(emit)
    buf = ""
    for token in tokens:
        buf += token
        ready, buf = _safe_split(buf)
        if not ready:
            continue
        ready, changed = swap(ready)
        for note in changed:
            emit("guard", note)
        piece = narr.feed(cutter.feed(ready))
        if piece:
            yield piece
    if buf:
        ready, changed = swap(buf)
        for note in changed:
            emit("guard", note)
        piece = narr.feed(cutter.feed(ready))
        if piece:
            yield piece
    last = narr.flush()
    if last:
        yield last

"""The pathway. Where she is, and where each answer sends her.

Hugo, after listening back to a call that reached the close by giving up rather
than by getting an answer: "we need to put the pathways where we can get her.
First step get the answer. Second step, if yes go side A, if no side B."

WHAT WAS WRONG WITH A LINE.

The first version was a straight line: four stages, next, next, next. It had a
give-up escape after three tries, because a gate with no escape traps somebody
forever. What actually happened is that the escape became the main road. She
would fail to get an answer, advance anyway, and arrive at the close having
skipped the middle. The log reads "4/4 the onboarding call (gave up asking)"
and the call is a shambles, because a line cannot express "they said no".

A CONVERSATION IS NOT A LINE. It is a graph. "Have you got a minute?" has three
real answers, not one, and each belongs somewhere different:

    yes            -> explain what you do
    I'm busy       -> arrange a better time, then stop
    not interested -> apologise, come off the list, stop

WHO DECIDES WHAT.

The model picks the EXIT, by name, because only it can tell "sounds good" from
"sounds expensive". The code owns the MAP: which exit leads where, what may
follow what, and when a call is over. So she can choose the road but never
invent one, and she cannot arrive somewhere there is no path to.

Each stage lists its exits by name in the brief, and she writes [GO: name] at
the start of the reply that earns it. Unknown name, or no marker, and she stays
exactly where she is.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Exit:
    key: str        # what she writes: [GO: yes]
    when: str       # the condition, in her words, shown in the brief
    goto: str       # which stage it leads to, or "" to end the call


@dataclass(frozen=True)
class Stage:
    key: str
    name: str
    do: str
    exits: tuple[Exit, ...]
    stuck: str
    # Where she is sent if she cannot get an answer at all. Never the best
    # outcome, always a graceful one: somebody who will not answer the same
    # question twice is telling you something.
    fallback: str


STAGES: dict[str, Stage] = {}
START = "permission"


def _add(s: Stage) -> Stage:
    STAGES[s.key] = s
    return s


_add(Stage(
    "permission", "asking to explain",
    "Say hello, give your name, say you are calling because you are LOOKING "
    "FOR A JOB, and ask if they mind you explaining. That is the whole turn. "
    "Do not say what you do, do not mention money. Your own words, different "
    "every call: there is no line to deliver here. TONE: warm and bright, "
    "[very warm], this is the moment to be liked.\n"
    "HOW IT LANDS matters more than the words. The ask is an odd thing to "
    "say and rushing past it is what sounds scripted, so give it a beat: a "
    "[break] just before the ask itself, then say it plainly, then the "
    "permission question and stop. \"Hey, it's Maria. [break] So this is a "
    "bit of an odd one, I'm actually calling to ask for a job. Mind if I "
    "explain?\" is the SHAPE, not a line to copy: short opener, breath, the "
    "odd truth said straight, one question. Never pile the name, the reason "
    "and the question into one breathless sentence.",
    (
        Exit("yes", "they said go on, or asked what you mean, or asked anything "
                    "at all about you. Any engagement counts", "explain"),
        Exit("busy", "they are busy, mid-job, or want you to call back another "
                     "time", "callback"),
        Exit("no", "they said no, not interested, or take me off the list",
             "decline"),
    ),
    "They have not answered yet. Ask again in fewer words and lighter.",
    "callback",
))

_add(Stage(
    "explain", "what you can do",
    "Say what you would DO for them in ONE short sentence, then ask how that "
    "sounds, then STOP. One sentence, not a list. You could mention answering "
    "every call, or booking jobs straight in, or chasing people up, but pick "
    "ONE and let them ask about the rest. Do not say \"I'm an AI "
    "receptionist\": describe the work. Do not mention money yet.\n"
    "Reading all five things at once takes eleven seconds, and eleven seconds "
    "of one voice is a speech, not a conversation. They stop listening and you "
    "have nothing left to say next.",
    (
        Exit("keen", "they actually engaged: answered your question, asked one "
                     "back, or said something with content in it. A bare grunt "
                     "or a lone \"okay\" is NOT engagement, stay and draw them "
                     "out", "money"),
        Exit("objection", "they pushed back: they already have somebody, they "
                          "do not need it, they do not like the idea",
             "objection"),
        Exit("no", "they explicitly ended it: not interested, take me off. "
                   "Doubts and questions are NOT this", "decline"),
    ),
    "They have not said what they make of it. Ask them straight what they think.",
    "money",
))

_add(Stage(
    "objection", "their objection",
    "Take it seriously and answer the actual objection in one or two "
    "sentences. Do not argue and do not stack reasons. Then ask one question "
    "that gets them talking about their own situation.",
    (
        Exit("ok", "they softened, engaged, or asked something else. Any answer "
                   "at all counts", "money"),
        Exit("no", "they explicitly refused. Hesitation is NOT a refusal",
             "decline"),
    ),
    "They have not moved. Do not push it a third time.",
    "decline",
))

_add(Stage(
    "money", "the wage",
    "Say what you cost, lightly and as a WAGE rather than a price: under five "
    "dollars a day, ninety-seven dollars a month. One line, then ask whether "
    "that is something they would be interested in, then STOP TALKING. The "
    "silence after that question is the question working: whoever speaks "
    "first loses, and it is never you. However long they take, you do not "
    "add, soften, re-ask or explain. Do not defend the value unless they "
    "push back, that is a different stage. TONE: grounded and steady here, "
    "[confident] or [calm], never bubbly: money talk delivered bright reads "
    "as a sales pitch, delivered steady it reads as a professional stating "
    "a fact, and this is where the trust is built.",
    (
        Exit("ok", "they said yes, or fine, or reacted positively at all",
             "book"),
        Exit("pricey", "hesitation about the MONEY: too much, can't afford "
                       "it, that's a lot, hmm. This is the common one",
             "value"),
        Exit("no", "they said no, or pushed back for any reason that is not "
                   "the price. A no here is an objection to hear, not the end "
                   "of the call", "objection"),
    ),
    "They have STILL not answered. Ask, in a handful of words, whether that "
    "works for them. Nothing else.",
    "book",
))

_add(Stage(
    "value", "worth it",
    "They think it is too much. You cannot drop the price. Put it against what "
    "ONE missed job is worth to them, in one sentence, and ask what a job is "
    "typically worth to them.",
    (
        Exit("ok", "they answered your question, or engaged with it AT ALL, "
                   "even grudgingly. Answering is engaging", "book"),
        Exit("no", "they explicitly refused: not interested, no thanks, take me "
                   "off. Hesitation is NOT a refusal", "decline"),
    ),
    "They are not moving on the money. Leave it.",
    "decline",
))

_add(Stage(
    "book", "the time",
    "Book them a short call with somebody from your team, who afterwards sets "
    "YOU up on THEIR line, never the other way round. You are NOT sending a link and you are NOT sending "
    "anything: you are booking a time. Offer two specific slots rather than "
    "asking when works for them, because an open question gets a shrug. When "
    "they pick, say it back and write [BOOK: their day and time] at the end. "
    "TONE: [confident], assume the yes. You are confirming details with "
    "somebody who has already agreed, not requesting an appointment, and the "
    "difference is audible.",
    (
        Exit("booked", "they gave you a day AND a time", ""),
        Exit("later", "they want to think about it, or check something first",
             "soft_close"),
        Exit("no", "they explicitly refused the call itself: not interested, "
                   "don't call me. A HALF answer is not this. \"Morning\", "
                   "\"sometime next week\", \"after five\" all mean YES and you "
                   "are one question away, so stay here and ask for the missing "
                   "half", "decline"),
    ),
    "They have not given you a time. Offer two different slots, then leave it.",
    "soft_close",
))

_add(Stage(
    "callback", "a better time",
    "They cannot talk now. Ask which day and roughly what time is better, say "
    "you will call back then, and write [BOOK: their day and time]. Keep it to "
    "one short sentence, because they have already told you they are busy.",
    (Exit("done", "they gave a time, or told you not to bother", ""),),
    "Do not ask a third time. Say you will try another day and let them go.",
    "",
))

_add(Stage(
    "soft_close", "leaving it with them",
    "They are not deciding today. Do NOT push. Tell them to think it over, say "
    "somebody can send the details across, and let them go warmly. One or two "
    "sentences.",
    (Exit("done", "you have said your piece", ""),),
    "Let them go.",
    "",
))

_add(Stage(
    "decline", "taking a no",
    "They are not interested. Apologise once, briefly, say you will take them "
    "off the list, and go. Never argue and never ask twice. One sentence.",
    (Exit("done", "you have apologised and offered to come off the list", ""),),
    "Let them go.",
    "",
))


def brief(key: str, stuck_turns: int = 0) -> str:
    """The instruction for where she is, rebuilt every turn.

    Rebuilt rather than accumulated, so a long call never ends up carrying two
    contradictory stages, and the prompt does not grow across the call.
    """
    s = STAGES.get(key) or STAGES[START]
    out = [
        f"\n\n=========== WHERE YOU ARE: {s.name.upper()} ===========",
        f"DO THIS, AND ONLY THIS: {s.do}",
        "",
        "THEN PICK WHERE THIS GOES. Start your reply with ONE of these, then "
        "say your line:",
    ]
    for e in s.exits:
        out.append(f"  [GO: {e.key}]   if {e.when}")
    out += [
        "  nothing at all   if none of those has happened yet. You stay here "
        "and try again a different way.",
        "",
        "The marker is never spoken aloud. It goes FIRST, before any words, "
        "because you are told to end your turn on a question and a marker "
        "written after a question mark is one you will forget.",
        "NEVER send a marker instead of a reply. You say something out loud "
        "every single turn.",
    ]
    if stuck_turns >= 1:
        out.append(f"\nYou have tried {stuck_turns + 1} times now. {s.stuck}")
    return "\n".join(out) + "\n"


def route(key: str, exit_key: str | None) -> tuple[str, bool]:
    """Where an exit leads. Returns (next stage, is the call over).

    The code owns this, not the model. An exit she invented, or one belonging to
    a different stage, leaves her exactly where she was: she can choose the road
    but she cannot invent one, and she cannot arrive somewhere there is no path
    to.
    """
    s = STAGES.get(key) or STAGES[START]
    if not exit_key:
        return s.key, False
    for e in s.exits:
        if e.key == exit_key.strip().lower():
            return (e.goto or s.key), (e.goto == "")
    return s.key, False


def give_up(key: str) -> tuple[str, bool]:
    """Where she goes when she cannot get an answer at all.

    Never the best outcome, always a graceful one. The old code sent the
    give-up path straight down the LINE, which is how a call reached "book a
    time" having skipped everything in between and then fell apart.
    """
    s = STAGES.get(key) or STAGES[START]
    return (s.fallback or ""), (s.fallback == "")

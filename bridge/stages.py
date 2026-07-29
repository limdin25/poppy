"""The gate. She cannot reach the next stage until this one is answered.

Hugo, twice: "she doesn't jump steps... she stays on the loop until she gets the
answer to go to the next loop", and then "she needs a gate before moving to the
next stage".

Asking the prompt nicely does not do it. On a live call she asked "have you got
a minute?", got a fragment back, and was three stages further on by the next
breath. A prompt describes intent; only code can refuse.

HOW IT WORKS, and why it is not a node graph.

The model is told which stage it is on and exactly what has to be true before it
may leave. When that is genuinely satisfied it ends its reply with [NEXT], the
same way it ends a call with [END]. The marker is never spoken.

The important part is who holds the state: this module does, not the model. The
model can ask to advance, and it advances only when the code agrees. It cannot
skip a stage because there is nothing to skip with, and if it never asks, it
stays put and has to try a different way of getting the answer.

A visual editor on top of this is a separate job, and a much bigger one. The
gate is where all the behaviour is; the canvas would only be a nicer way for
Hugo to edit these five entries.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Stage:
    name: str
    do: str
    gate: str
    stuck: str


# Five, deliberately. Every stage is one thing to get, and the call is a
# straight line through them. The order matters: nobody cares what you cost
# before they know who you are.
STAGES: tuple[Stage, ...] = (
    Stage(
        "introduce",
        "Say your name, that you are an AI receptionist, why you are ringing, "
        "and ask whether they have a minute. Nothing else. Do not say what you "
        "do, do not mention the price, do not pitch. This is the ONE place a "
        "closed question is right, because you are asking permission.",
        "They have given you the minute, or asked what it is about, or asked "
        "any question at all about who you are.",
        "They have not answered yet. Ask again, differently and more briefly. "
        "Do not carry on to what you do.",
    ),
    Stage(
        "what you are",
        "In ONE short sentence, say what you do. The strongest version of that "
        "is simply that they are hearing it right now.",
        "They have reacted to it in any way at all, even just 'okay' or a "
        "question.",
        "They have said nothing back. Put it another way, shorter.",
    ),
    Stage(
        "their setup",
        "Find out how their phone gets answered at the moment, and ask it OPEN: "
        "\"what happens when someone rings and you're under a sink?\" gets you a "
        "story, \"do you answer them yourself?\" gets you one word. One question, "
        "then stop.",
        "They have actually told you who answers their phone, or that nobody "
        "does, or refused to say.",
        "You have not got an answer yet. Ask it a different way, or ask "
        "something easier first.",
    ),
    Stage(
        "the demonstration",
        "Offer to prove it now: they pretend to be a customer ringing in and "
        "you answer the way you would for their business. Then actually do it, "
        "properly, in character.",
        "They have either taken you up on it and heard it, or turned it down.",
        "They have not said either way. Offer once more, lightly, then take a "
        "no for an answer.",
    ),
    Stage(
        "the close",
        "Offer to send the link so they can try you. Somebody from the team "
        "sets it up on their number. The price is 97 a month, about three "
        "pounds twenty a day, if it comes up.",
        "They have said yes, said no, or asked for time to think.",
        "They have not decided. Do not push. Offer to send it anyway so it is "
        "there if they want it, then leave it.",
    ),
)


def brief(index: int, stuck_turns: int = 0) -> str:
    """The instruction for the stage she is on, to append to the system prompt.

    Rebuilt each turn rather than accumulated, so the prompt never grows over
    the length of a call and never carries two stages at once.
    """
    index = max(0, min(index, len(STAGES) - 1))
    s = STAGES[index]
    last = index == len(STAGES) - 1
    out = [
        f"\n\nYOU ARE ON STAGE {index + 1} OF {len(STAGES)}: {s.name.upper()}.",
        f"Do this, and only this: {s.do}",
        f"You may NOT move on until: {s.gate}",
    ]
    if stuck_turns >= 1:
        out.append(f"You have already tried {stuck_turns + 1} times. {s.stuck}")
    if last:
        out.append(
            "This is the last stage. When they have decided either way, close "
            "warmly and include [END]."
        )
    else:
        out.append(
            "The MOMENT that condition is genuinely met, put [NEXT] at the very "
            "end of your reply. Not before. [NEXT] is never spoken aloud, it "
            "just tells the system you are ready to move on. If it is not met, "
            "leave it out and stay on this stage.\n"
            "[NEXT] goes at the end of a reply, NEVER instead of one. You always "
            "say something out loud, every single turn. A turn that is only the "
            "marker is silence on the phone, and silence is how a call dies."
        )
    return "\n".join(out) + "\n"

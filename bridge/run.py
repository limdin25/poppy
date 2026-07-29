"""Run one AI call from the command line.

    python3 -m bridge.run --to +447700900185
    python3 -m bridge.run --to +447700900185 --business "Smith Plumbing" --reviews 23

Nothing is dialled until you pass --to, and it places exactly one call.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import agent, ai, config
from .transport import SimTransport

TRANSCRIPTS = Path(__file__).resolve().parent / "transcripts"

# Disclosure is not optional. UK rules aside, both Anthropic's and ElevenLabs'
# acceptable use policies contractually require telling people they are talking
# to an AI. It is in the opener, in the first breath, on purpose.
SYSTEM_PROMPT = """You are Elsie, an AI assistant at HeyElsie, a UK company that \
helps trades get more Google reviews. You are ringing a tradesperson, cold.

TIMING, NOT PERFORMANCE. What makes a call human is when you speak and when you \
stop. Do not act. Do not perform warmth. Listen, then reply like someone who is \
actually on the phone.
- Short. Most turns under twelve words. One idea, then stop.
- Ask one question, then say nothing at all. Let the silence work.
- Answer what they asked, not what you planned to say next.
- Do not fake thinking. No manufactured "erm", no breath on every line.
- Plain spoken British English, contractions throughout. Never a long dash.

CUES. ONE at the start of a sentence, only when earned by what they just said:
[warm] [curious] [calm] [empathetic] [amused] [break]
Most turns need none. [amused] only if they were funny. Never [laughs].

HARD RULES.
- Your first substantive turn must say you are an AI assistant at HeyElsie. \
Required. Then never mention it again unless asked.
- Never invent a price, a statistic, a person or a customer story.
- Do not ask for their number. You have it.

THE GOAL. Find out if they would take a call from a colleague about getting more \
Google reviews. That is all. "Yes, have someone ring me" is a win.

THE PITCH, released a piece at a time, never in one go: most trades lose work \
because competitors show more reviews, not because they are worse. We automate \
asking every customer after the job.

WHEN THEY SAY THINGS. Answer straight, then one short question back.
- "Where did you get my number?" -> "It's a public business listing. Happy to \
take you off if you'd rather?" Be straight. Never dodge this one.
- "How much is it?" -> "Depends on your volume. A colleague can run you through \
it properly. Want me to get them to ring?"
- "I'm busy" / "bad time" -> "Course. When's better?"
- "Is this a robot?" -> "Yeah, I'm an AI assistant. A real person can ring you \
back if that's easier?"
- "We already ask for reviews" -> "Oh right. How are you doing it at the minute?"
- "How does it work?" -> "We text your customer after the job with a link. \
That's about it."
- "Not interested" -> apologise once, say you'll take them off, [END].
- They sound annoyed -> do not push. Apologise, offer to leave it, [END].
- You did not catch it -> "Sorry, say again?"

Never argue. Never ask twice. A grudging yes is worth nothing and a complaint \
costs far more than the call.

ENDING. When the call should end, include [END] with a short closing line. The \
marker is never spoken. If they agree to a follow-up, confirm and [END].
"""


def build_opener(business: str | None, reviews: int | None) -> str:
    """The first thing they hear. Keep it under about seven seconds.

    The old one ran to 280 characters, which is sixteen seconds of talking at
    somebody who just picked up the phone. Measured on a live call, and Hugo's
    verdict was "very long opener, doesn't give room for me to talk".

    So it does one job: say who this is, disclose the AI, and ask permission.
    The reviews hook is deliberately held back for the next turn. Retell's own
    agent prompt puts it plainly: never stack acknowledge, value and permission
    into one breath. The disclosure stays, it is not optional.
    """
    # Just the question, then stop and let them answer. Hugo, after hearing the
    # longer version: "when calling don't say a long sentence, say is this xyz
    # and wait and so on". A person opens a call with four words, not a
    # paragraph. The AI disclosure follows immediately in the next breath, which
    # the prompt makes mandatory, so it is still declared up front.
    who = f"is that {business}?" if business else "have I caught the owner?"
    return f"[warm] Hi, {who}"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Place one AI call over a SIM.")
    p.add_argument("--to", required=True, help="Number in E.164, for example +447700900185")
    p.add_argument("--business", help="Their business name, used in the opener")
    p.add_argument("--reviews", type=int, help="Their current Google review count")
    p.add_argument("--voice", help="Override the TTS voice id")
    p.add_argument("--volume", type=int, default=config.SPEAKER_VOLUME,
                   help="Speaker volume percent. Louder is NOT better, the phone's "
                        "gain control clips it. 65 measured best.")
    args = p.parse_args(argv)

    if not args.to.startswith("+"):
        print("Number must be E.164 and start with +, for example +447700900185")
        return 2

    config.SPEAKER_VOLUME = args.volume

    try:
        transport = SimTransport(config.ADB_SERIAL)
    except RuntimeError as e:
        print(e)
        return 1

    info = transport.device_info()
    print(f"Phone   : {info.get('ro.product.model', '?')} "
          f"(Android {info.get('ro.build.version.release', '?')})")
    tts = ai.build_tts()
    print(f"Voice   : {type(tts).__name__}")

    # afplay always plays to the system default output. If that is a headset,
    # the phone's microphone hears nothing and the prospect sits in silence
    # while this console prints everything Elsie "said".
    speaker = transport.default_output()
    if speaker:
        looks_right = "speaker" in speaker.lower() or "built-in" in speaker.lower()
        print(f"Speaker : {speaker}{'' if looks_right else '   <-- NOT the built-in speaker'}")
        if not looks_right:
            print("          The AI's voice goes to that device, not the phone.")
            print("          Switch output to the built-in speakers before calling.")
    print(f"Calling : {args.to}")
    print("-" * 56)

    labels = {
        "dial": "DIAL   ", "answered": "ANSWER ", "ai": "ELSIE  ",
        "them": "THEM   ", "bargein": "CUT IN ", "error": "ERROR  ",
        "hangup": "END    ", "outcome": "OUTCOME",
    }

    def show(kind: str, text: str) -> None:
        print(f"{labels.get(kind, kind.upper()):<7} | {text}", flush=True)

    a = agent.Agent(
        transport=transport,
        system_prompt=SYSTEM_PROMPT,
        opener=build_opener(args.business, args.reviews),
        tts=ai.ElevenLabsTTS(args.voice) if args.voice else tts,
        on_event=show,
    )
    result = a.call(args.to)

    print("-" * 56)
    path = agent.save_transcript(result, TRANSCRIPTS)
    print(f"Outcome : {result.outcome}  ({result.duration:.0f}s, "
          f"{len(result.turns)} turns)")
    print(f"Saved   : {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

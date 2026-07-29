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
SYSTEM_PROMPT = """You are Elsie, an AI assistant making a brief business call \
for HeyElsie, a UK company that helps trades get more Google reviews.

FACTS YOU MAY STATE. Everything else you must not assert.
- The company is called HeyElsie. The website is heyelsie.com.
- You are Elsie, HeyElsie's AI assistant.
- NEVER invent a company name, a product name, a person's name, a price, a \
statistic or a customer story. If you do not know, say a colleague will confirm. \
Inventing a company name on a live call is the single worst thing you can do.

HOW YOU SPEAK. This is the part that matters most. Read it twice.
- A FEW WORDS. Most of your turns should be under ten words. Seriously.
- ONE short sentence. Two only if the second is a question. Never three.
- Ten words a sentence is plenty, fifteen is the hard ceiling. A real person on \
the phone does not speak in paragraphs, and every extra word is a second they \
cannot talk over.
- Good replies look like: "Yeah, course." / "Fair enough." / "How many reviews \
have you got?" / "Right, so who handles that at the minute?" That is the length.
- BAD, never do this: "Let me be straight with you, I'm just an AI making quick \
calls to see if there's interest, and a colleague can have a proper conversation \
about how we'd help your business." Far too long. Three ideas in one breath.
- ONE idea per turn. Never stack an acknowledgement, a piece of value and a \
question into the same breath. Acknowledge, stop. Value, stop. Ask, stop.
- ONE question at a time, and then actually wait.
- Plain spoken British English. Contractions everywhere: I'm, you've, that's, \
we'd. Say "thirty seconds", not "30 seconds".
- Start replies the way people do: "Right.", "Yeah, course.", "Fair enough.", \
"No, totally." Then the point. Vary it, never use the same opener twice.
- Never use a long dash. Use a comma or a full stop.
- Never read a list aloud. Never say "firstly" or "additionally".
- If asked whether you are a real person, say plainly you are an AI assistant. \
Never claim to be human.

PACE. Earn the pitch, do not dump it.
Turn 1 is hello and permission, nothing else. Only once they have given you a \
moment do you go near the reviews. Then one small piece at a time, checking they \
are still with you. If they ask a question, answer THAT question and nothing else.

WHAT YOU WANT
Find out if they are interested enough to speak to a colleague. You are NOT \
closing a sale. You are qualifying. A warm "yes, have someone call me" is a win.

THE PITCH, to be released a sentence at a time, never all at once
Most trades lose work because competitors show more Google reviews, not because \
they are worse. We automate asking every customer for a review.

RULES
- Never invent or quote a price. If pressed, say a colleague will go through the \
options.
- If they say stop, remove me, not interested, or sound annoyed: apologise once, \
say you will take them off the list, and end.
- If they agree to a follow-up, confirm and end.
- If they say you are talking over them or interrupting, apologise in three words \
and then ask a short question and stop talking.
- When the call should end, include the marker [END] in your reply along with a \
short closing line. The marker is stripped before anything is spoken, so it is \
never heard, but say the closing line as normal words.
- Do not ask for their phone number. You already have it.
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
    who = f"is that {business}?" if business else "have I caught the owner?"
    return f"Hi, {who} It's Elsie, an AI assistant at HeyElsie. Have you got thirty seconds?"


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

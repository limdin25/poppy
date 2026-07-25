# Generates the voice-only segments of the VSL with the cloned actor voice
# (Coqui XTTS v2, local). Usage: ../tts-env/bin/python gen_voice.py
import os
from TTS.api import TTS

REF = os.path.join(os.path.dirname(__file__), '..', 'assets', 'actor-ref.wav')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'audio', 'voice')

# segment id → text (voice-only parts of the locked 2026-07-24 script:
# 01 hook + 16-26 solution→CTA; 02-15 are the round3 actor videos)
SEGMENTS = {
    'seg-01': "In the next couple of minutes, I'm gonna show you how local service business owners are getting hundreds of reviews from their customers — without lifting a finger.",
    'seg-16': "We have a simple tool that plugs into your systems, to automate the process of requesting reviews. But these aren't any review requests.",
    'seg-17': "We send out personalised image review requests. What that means is — if you worked with Kate, we'll send Kate a photo of you, your logo, or your team — and we auto-populate her name on the image. This gets her attention — and it can five-x the amount of reviews that you're getting.",
    'seg-18': "I spent years fine-tuning our review system, to make it easy for non-tech-savvy business owners to get set up. This is a one-time, set-it-and-forget-it software. When you join, it'll take about five minutes to set up with us — and you'll never worry about reviews again.",
    'seg-19': "We have a seamless integration into all the biggest CRMs and tools that you use. And it runs automatically in the background, without you having to do a thing.",
    'seg-20': "Not to mention — we respond to the reviews for you. And we help repurpose these reviews, so everyone in your sphere knows how awesome you are as a company.",
    'seg-21': "This is optional — but if you want to get your reviews rolling in quickly, we can reactivate your past customers straight away — and get up to 25 free reviews.",
    'seg-22': "That means we'll contact customers from the last three months, and ask them to leave a Google review. We typically see around a ten percent review conversion rate from past customers — and fifty to seventy percent from new customers.",
    'seg-23': "One more bonus — also completely optional. You can connect your social media accounts to our system, and we'll automatically turn your Google reviews into social media posts, and publish them for you — creating even more awareness for your business.",
    'seg-24': "Now, I also want to be completely honest with you. This is important. We only work with a handful of businesses in each area — because we don't want our own clients competing against each other.",
    'seg-25': "So if you decide not to join us — someone else will take your spot. And they'll be the business getting those extra calls instead.",
    'seg-26': "We've already spoken — and I'd genuinely love to have you on board. So click the button below — and we'll get everything set up.",
}

tts = TTS('tts_models/multilingual/multi-dataset/xtts_v2')
for name, text in SEGMENTS.items():
    out = os.path.join(OUT, f'{name}.wav')
    if os.path.exists(out):
        continue
    tts.tts_to_file(text=text, speaker_wav=REF, language='en', file_path=out)
    print(f'✓ {name}', flush=True)
print('ALL DONE')

# Generates the VSL v2 "Google says it themselves" voiceover segments with the
# cloned actor voice (Coqui XTTS v2, local). One file per script block so the
# editing agents can cut freely. Usage: ../tts-env/bin/python gen_voice_v2.py
import os
from TTS.api import TTS

REF = os.path.join(os.path.dirname(__file__), '..', 'assets', 'actor-ref.wav')
OUT = os.path.join(os.path.dirname(__file__), '..', 'out', 'vsl-v2-audio')

SEGMENTS = {
    '01-hook': "Quick video. I'll show you how local businesses are getting hundreds of Google reviews — without lifting a finger. This exact system took the Mayfair Plumber from 17 reviews to over 300… in four months.",
    '02-before-after': "And look — I checked your listing. You're near the bottom. When someone in your area needs a service, they call the businesses at the top. Right now, that's not you. And that's exactly where we're going to get you.",
    '03-google-proof': "Now — don't take my word for it. This is Google saying it. On their own official page. Here it is, read it yourself: “Star ratings and number of reviews affect how your business is ranked.” Google is literally telling you — more reviews, higher rank. Higher rank, more calls. This isn't a trend. It's how Google works now.",
    '04-why': "So why isn't it happening? Happy customers forget the second they walk out the door. And you're too busy doing the actual work. That's it. That's the whole problem.",
    '05-fix': "So we built something that does it all for you. We ask for the reviews — personalised, your customer's name right on the image, not some boring text everybody ignores. Google themselves say people are more likely to leave a review when the request comes from you. We reply to every review for you, in your voice. It's set and forget. Five minutes, one time, and you never think about reviews again.",
    '06-reactivation': "And to start fast — we go back to your past customers. The people who already love your work. That's up to 25 new reviews from customers you've already served — and for most businesses, that doubles their review count in the first month.",
    '07-close': "Now, being straight with you — we only take a handful of businesses in each area. If you don't take it, it goes to someone else, and they get the calls instead. The price is on the button below — and honestly, it's less than a single job. But you don't have to decide on that today. Test the whole thing for one pound, for ten days. If it's not getting you reviews, cancel — and you're out a pound. Click the button below — and we'll get everything set up for you.",
}

os.makedirs(OUT, exist_ok=True)
tts = TTS('tts_models/multilingual/multi-dataset/xtts_v2')
for name, text in SEGMENTS.items():
    out = os.path.join(OUT, f'{name}.wav')
    if os.path.exists(out):
        continue
    tts.tts_to_file(text=text, speaker_wav=REF, language='en', file_path=out)
    print(f'✓ {name}', flush=True)
print('ALL DONE')

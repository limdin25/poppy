#!/bin/bash
# Generates the VSL v2 voiceover with the ElevenLabs-cloned actor voice.
# Usage: ./gen_voice_el.sh  (key + voice id inside)
KEY="sk_f9ded46549562211a6ab18f9180d3625680c45846ae4871b"
VOICE="o6wnoeR1UlXDVucYjZmq"
OUT="/Users/hugo/Whats/Poppy/video/out/vsl-v2-audio-el"
mkdir -p "$OUT"

gen() {
  local name="$1"; local text="$2"
  [ -f "$OUT/$name.wav" ] && return
  curl -s -X POST "https://api.elevenlabs.io/v1/text-to-speech/$VOICE?output_format=pcm_44100" \
    -H "xi-api-key: $KEY" -H "Content-Type: application/json" \
    -d "$(node -e "console.log(JSON.stringify({text: process.argv[1], model_id: 'eleven_multilingual_v2', voice_settings: {stability: 0.5, similarity_boost: 0.8}}))" "$text")" \
    -o "/tmp/el-$name.pcm"
  ffmpeg -v error -f s16le -ar 44100 -ac 1 -i "/tmp/el-$name.pcm" "$OUT/$name.wav" -y
  echo "✓ $name"
}

gen "01-hook" "Quick video. I'll show you how local businesses are getting hundreds of Google reviews — without lifting a finger. This exact system took the Mayfair Plumber from 17 reviews to over 300… in four months."
gen "02-before-after" "And look — I checked your listing. You're near the bottom. When someone in your area needs a service, they call the businesses at the top. Right now, that's not you. And that's exactly where we're going to get you."
gen "03-google-proof" "Now — don't take my word for it. This is Google saying it. On their own official page. Here it is, read it yourself: “Star ratings and number of reviews affect how your business is ranked.” Google is literally telling you — more reviews, higher rank. Higher rank, more calls. This isn't a trend. It's how Google works now."
gen "04-why" "So why isn't it happening? Happy customers forget the second they walk out the door. And you're too busy doing the actual work. That's it. That's the whole problem."
gen "05-fix" "So we built something that does it all for you. We ask for the reviews — personalised, your customer's name right on the image, not some boring text everybody ignores. Google themselves say people are more likely to leave a review when the request comes from you. We reply to every review for you, in your voice. It's set and forget. Five minutes, one time, and you never think about reviews again."
gen "06-reactivation" "And to start fast — we go back to your past customers. The people who already love your work. That's up to 25 new reviews from customers you've already served — and for most businesses, that doubles their review count in the first month."
gen "07-close" "Now, being straight with you — we only take a handful of businesses in each area. If you don't take it, it goes to someone else, and they get the calls instead. The price is on the button below — and honestly, it's less than a single job. But you don't have to decide on that today. Test the whole thing for one pound, for ten days. If it's not getting you reviews, cancel — and you're out a pound. Click the button below — and we'll get everything set up for you."
echo "ALL DONE"

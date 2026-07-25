// Generates the VSL v2 voiceover with the ElevenLabs-cloned actor voice.
// Usage: node gen_voice_el.mjs
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { execSync } from 'child_process'

const KEY = 'sk_f9ded46549562211a6ab18f9180d3625680c45846ae4871b'
const VOICE = 'o6wnoeR1UlXDVucYjZmq'
const OUT = '/Users/hugo/Whats/Poppy/video/out/vsl-v2-audio-el'
mkdirSync(OUT, { recursive: true })

const SEGMENTS = {
  '01-hook': "Quick video. I'll show you how local businesses are getting hundreds of Google reviews — without lifting a finger. This exact system took the Mayfair Plumber from 17 reviews to over 300… in four months.",
  '02-before-after': "And look — I checked your listing. You're near the bottom. When someone in your area needs a service, they call the businesses at the top. Right now, that's not you. And that's exactly where we're going to get you.",
  '03-google-proof': "Now — don't take my word for it. This is Google saying it. On their own official page. Here it is, read it yourself: “Star ratings and number of reviews affect how your business is ranked.” Google is literally telling you — more reviews, higher rank. Higher rank, more calls. This isn't a trend. It's how Google works now.",
  '04-why': "So why isn't it happening? Happy customers forget the second they walk out the door. And you're too busy doing the actual work. That's it. That's the whole problem.",
  '05-fix': "So we built something that does it all for you. We ask for the reviews — personalised, your customer's name right on the image, not some boring text everybody ignores. Google themselves say people are more likely to leave a review when the request comes from you. We reply to every review for you, in your voice. It's set and forget. Five minutes, one time, and you never think about reviews again.",
  '06-reactivation': "And to start fast — we go back to your past customers. The people who already love your work. That's up to 25 new reviews from customers you've already served — and for most businesses, that doubles their review count in the first month.",
  '07-close': "Now, being straight with you — we only take a handful of businesses in each area. If you don't take it, it goes to someone else, and they get the calls instead. The price is on the button below — and honestly, it's less than a single job. But you don't have to decide on that today. Test the whole thing for one pound, for ten days. If it's not getting you reviews, cancel — and you're out a pound. Click the button below — and we'll get everything set up for you.",
}

for (const [name, text] of Object.entries(SEGMENTS)) {
  const mp3 = `${OUT}/${name}.mp3`
  if (existsSync(mp3)) { console.log(`skip ${name}`); continue }
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.8 },
    }),
  })
  if (!res.ok) { console.error(`${name}: HTTP ${res.status}`, (await res.text()).slice(0, 200)); process.exit(1) }
  writeFileSync(mp3, Buffer.from(await res.arrayBuffer()))
  console.log(`✓ ${name}`)
}
console.log('ALL DONE')

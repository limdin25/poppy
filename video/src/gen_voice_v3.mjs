// VSL v3 voiceover — full script in two British voices for Hugo to compare.
// Usage: node gen_voice_v3.mjs
import { writeFileSync, mkdirSync, existsSync } from 'fs'

const KEY = 'sk_f9ded46549562211a6ab18f9180d3625680c45846ae4871b'
const OUT = '/Users/hugo/Whats/Poppy/video/out/vsl-v3-audio'
mkdirSync(OUT, { recursive: true })

const VOICES = {
  'rence': 'gPwRuuANmRuxTOH9IZ9d',      // C — conversational, mate-to-mate
  'steve-north-london': 'HhgLQVNWj1DrCMCdusVj', // D — street-level London
}

const SECTIONS = {
  '1-hook': "Quick video. I'll show you how your competitors are making more money — just because they rank higher on Google. Have a look — these are the businesses in your area.",
  '2-story': "The ones at the top get all the calls. Scroll down… and there you are, near the bottom. So the best jobs go to the ones up top. Simple as that. And the only reason they're up there is more reviews. Don't take my word for it — this is Google's own page: “More reviews and positive ratings can improve your business's local ranking.” More reviews, higher up. Higher up, more jobs.",
  '3-fix': "So why isn't it happening for you? Soon as you finish a job, the customer forgets to leave a review. You're onto the next one, they get on with their day, and that five-star review never happens. So here's what we do. We plug into your system, and every time you finish a job we text your customer a friendly message asking for a review — with follow-ups, so it actually gets done. You don't lift a finger. And we start with the customers you've already worked for, so it kicks off fast.",
  '4-offer': "Straight with you — we only work with five businesses per city, so our customers aren't competing against each other. So while there's still a spot: start for one pound, for ten days. Not getting reviews? Cancel — you're out a quid. After that it's from ninety-nine pounds a month, cancel any time. Tap the button below and we'll set it all up for you.",
}

for (const [vname, voiceId] of Object.entries(VOICES)) {
  for (const [sec, text] of Object.entries(SECTIONS)) {
    const file = `${OUT}/${sec}--${vname}.mp3`
    if (existsSync(file)) { console.log(`skip ${sec} ${vname}`); continue }
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.45, similarity_boost: 0.75 } }),
    })
    if (!res.ok) { console.error(`${sec} ${vname}: HTTP ${res.status}`, (await res.text()).slice(0, 150)); process.exit(1) }
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    console.log(`✓ ${sec} ${vname}`)
  }
}
console.log('ALL DONE')

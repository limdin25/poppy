// Generates hook-segment samples with candidate British voices for Hugo to
// pick by ear. Usage: node pick_voice.mjs
import { writeFileSync, mkdirSync, existsSync } from 'fs'

const KEY = 'sk_f9ded46549562211a6ab18f9180d3625680c45846ae4871b'
const OUT = '/Users/hugo/Whats/Poppy/video/out/voice-pick'
mkdirSync(OUT, { recursive: true })

const HOOK = "Quick video. I'll show you how local businesses are getting hundreds of Google reviews — without lifting a finger. This exact system took the Mayfair Plumber from 17 reviews to over 300… in four months. And look — I checked your listing. You're near the bottom."

const CANDIDATES = {
  'A-george-warm-storyteller': 'JBFqnCBsd6RMkjVDRZzb',
  'B-daniel-steady-broadcaster': 'onwK4e9ZLuTAKqWW03F9',
  'C-rence-conversational': 'gPwRuuANmRuxTOH9IZ9d',
  'D-steve-north-london': 'HhgLQVNWj1DrCMCdusVj',
  'E-mark-durham-northern': '0CoxwbC90B8N0Fa3LDCH',
}

for (const [name, voiceId] of Object.entries(CANDIDATES)) {
  const mp3 = `${OUT}/${name}.mp3`
  if (existsSync(mp3)) { console.log(`skip ${name}`); continue }
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: HOOK,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.45, similarity_boost: 0.75 },
    }),
  })
  if (!res.ok) { console.error(`${name}: HTTP ${res.status}`, (await res.text()).slice(0, 150)); continue }
  writeFileSync(mp3, Buffer.from(await res.arrayBuffer()))
  console.log(`✓ ${name}`)
}
console.log('DONE')

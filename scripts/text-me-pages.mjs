// text-me-pages.mjs — send Hugo the live per-lead pages for a niche, so he can
// open them on his phone exactly as a prospect would.
//
//   node scripts/text-me-pages.mjs --niche=electrician --to=+447863992555 [--apply]

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
for (const line of readFileSync(resolve(REPO, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const NICHE = arg('niche', 'electrician')
const TO = arg('to', '+447863992555')
const FROM = arg('from', '+447426495169')
const APPLY = process.argv.includes('--apply')

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const { data: contacts } = await supa
  .from('wk_contacts').select('id, name, custom_fields')
  .filter('custom_fields->>niche', 'eq', NICHE)
const ids = new Set((contacts || []).map((c) => c.id))
const byId = new Map((contacts || []).map((c) => [c.id, c]))

const { data: pages } = await supa
  .from('wk_vsl_pages').select('slug, contact_id, town, render_status, video_url')
  .eq('render_status', 'ready')
const ready = (pages || []).filter((p) => ids.has(p.contact_id) && p.video_url)

if (!ready.length) { console.log('no ready pages yet'); process.exit(0) }

const lines = ready.map((p) => {
  const cf = byId.get(p.contact_id)?.custom_fields || {}
  return `${byId.get(p.contact_id)?.name} (${p.town}, #${cf.rank} of ${cf.total_plumbers}, ${cf.reviews} reviews)\nheyelsie.com/${p.slug}`
})

const body = `Electricians are live. 100 scraped fresh from real "electricians in {town}" searches, so every rank and competitor is from their OWN trade — not the plumber data.\n\n${lines.join('\n\n')}\n\nOpen one: every Google card in the video says Electrician, and the examples underneath are real London electricians. No plumbers anywhere.`

console.log('--- to', TO, '---\n' + body + `\n\n(${body.length} chars, ${Math.ceil(body.length / 153)} segments)`)
if (!APPLY) { console.log('\ndry run — add --apply to send'); process.exit(0) }

const SID = process.env.TWILIO_ACCOUNT_SID
const TOKEN = process.env.TWILIO_AUTH_TOKEN
const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
  method: 'POST',
  headers: {
    Authorization: `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({ To: TO, From: FROM, Body: body }),
})
const j = await res.json()
console.log(res.ok ? `sent ${j.sid} (${j.status})` : `FAILED ${j.code}: ${j.message}`)

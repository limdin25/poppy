// queue-trade-videos.mjs — create wk_vsl_pages rows + queue renders for a set
// of leads, without needing an agent JWT. Mirrors api/crm/vsl-page.ts:131-206.
//
//   node scripts/queue-trade-videos.mjs --niche=electrician --count=5 [--apply]
//
// The VPS worker (systemd vsl-render-worker) claims queued rows every 30s.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
for (const line of readFileSync(resolve(REPO, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const NICHE = arg('niche', 'electrician')
const COUNT = parseInt(arg('count', '5'), 10)
const APPLY = process.argv.includes('--apply')

const RESERVED = new Set(['api', 'assets', 'r', 'report', 'welcome', 'subscribe', 'login', 'register', 'settings'])
function slugify(name) {
  const base = String(name).toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '')
  const safe = base || 'business'
  return RESERVED.has(safe) ? `${safe}-video` : safe
}

const { data: leads, error } = await supa
  .from('wk_contacts')
  .select('id, name, custom_fields')
  .filter('custom_fields->>niche', 'eq', NICHE)
  .limit(200)
if (error) { console.error(error.message); process.exit(1) }

// an agent to own the pages — reuse whoever owns the existing funnel rows
const { data: anyPage } = await supa
  .from('wk_vsl_pages').select('agent_id').not('agent_id', 'is', null).limit(1).maybeSingle()
const AGENT = anyPage?.agent_id || null

// Prefer leads with a real (capturable) website and the most competitors above
// them — those make the strongest video.
const SOCIAL = /(facebook|fb\.me|instagram|linkedin|yell\.com|checkatrade|business\.site)/i
const ranked = leads
  .filter((l) => l.custom_fields?.website && !SOCIAL.test(l.custom_fields.website))
  .sort((a, b) => Number(b.custom_fields.rank || 0) - Number(a.custom_fields.rank || 0))
  .slice(0, COUNT)

console.log(`${leads.length} ${NICHE} leads, ${ranked.length} picked (real website, deepest rank)\n`)
for (const l of ranked) {
  console.log(`  ${l.name.slice(0, 34).padEnd(36)} ${l.custom_fields.town.padEnd(14)} rank ${String(l.custom_fields.rank).padStart(2)}  ${l.custom_fields.reviews} rev`)
}
if (!APPLY) { console.log('\ndry run — re-run with --apply'); process.exit(0) }

let made = 0
for (const l of ranked) {
  const cf = l.custom_fields || {}
  // existing page for this contact?
  const { data: existing } = await supa
    .from('wk_vsl_pages').select('*').eq('contact_id', l.id).maybeSingle()

  let page = existing
  if (!page) {
    let slug = slugify(l.name)
    for (let i = 2; i <= 20; i++) {
      const { data: clash } = await supa.from('wk_vsl_pages').select('id').eq('slug', slug).maybeSingle()
      if (!clash) break
      slug = `${slugify(l.name)}-${i}`
    }
    const { data, error: e } = await supa.from('wk_vsl_pages').insert({
      slug,
      contact_id: l.id,
      agent_id: AGENT,
      business_name: l.name,
      owner_first: (cf.owner_name || '').split(/\s+/)[0] || null,
      town: cf.town || null,
      cta_variant: made % 2 ? 'b' : 'a',
      no_website: false,
      state: 'created',
    }).select('*').single()
    if (e) { console.warn(`  ! ${l.name}: ${e.message}`); continue }
    page = data
  }

  if (page.render_status && page.render_status !== 'failed') {
    console.log(`  = ${page.slug} already ${page.render_status}`)
    continue
  }
  const { error: e2 } = await supa.from('wk_vsl_pages').update({
    render_status: 'queued',
    render_requested_at: new Date().toISOString(),
    render_error: null,
  }).eq('id', page.id)
  if (e2) { console.warn(`  ! ${page.slug}: ${e2.message}`); continue }
  console.log(`  + queued  https://heyelsie.com/${page.slug}`)
  made++
}
console.log(`\n${made} queued — the VPS worker claims one every 30s (~5 min each)`)

// VSL render worker — the video factory. Runs on the Hostinger VPS
// (margarita-server) as systemd service `vsl-render-worker`.
//
//   node scripts/vsl-render-worker.mjs        (env from repo .env)
//
// Loop every 30s:
//   claim oldest wk_vsl_pages.render_status='queued'  (atomic PATCH-if-queued)
//   → prep-lead (pack + capture + lead-gen.json)
//   → remotion render → out/leads/<slug>.mp4 (~5–10 min, one at a time)
//   → ffmpeg poster → upload both to the public `vsl-videos` bucket
//   → video_url/poster_url + render_status='ready' → board flips live
// Failures land in render_status='failed' + render_error (agent sees Retry).
// Stale 'rendering' rows (>45 min — reboot mid-render) are re-queued.
//
// Pipeline column move duplicates api/lib/vsl-settings.ts VSL_COLUMN_ORDER —
// KEEP IN LOCKSTEP.

import { readFileSync, existsSync, mkdirSync } from 'fs'
import { execFileSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const VIDEO = join(REPO, 'video')

// load repo .env (KEY=value lines only — no interpolation)
try {
  for (const line of readFileSync(join(REPO, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* env may come from systemd instead */ }

const SUPABASE_URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !KEY) { console.error('missing SUPABASE_URL / SERVICE_ROLE_KEY'); process.exit(1) }

const POLL_MS = 30_000
const STALE_MIN = 45
const BUCKET = 'vsl-videos'

// KEEP IN LOCKSTEP with api/lib/vsl-settings.ts
const COLUMN_ORDER = [
  'Rendering', 'Ready to send', 'Video sent', 'Opened page', 'Watched video',
  'Clicked button', 'Checkout started', 'Paid',
]

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const HJ = { ...H, 'Content-Type': 'application/json' }

async function rest(method, path, body, headers = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: { ...HJ, ...headers }, body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

async function moveCard(contactId, columnName) {
  try {
    const cols = await rest('GET', `wk_pipeline_columns?select=id,name&name=in.(${COLUMN_ORDER.map((c) => `"${c}"`).join(',')})`)
    const target = cols.find((c) => c.name === columnName)?.id
    if (!target) return
    const [contact] = await rest('GET', `wk_contacts?id=eq.${contactId}&select=id,pipeline_column_id`)
    if (!contact) return
    const currentName = cols.find((c) => c.id === contact.pipeline_column_id)?.name
    if (currentName && COLUMN_ORDER.indexOf(currentName) >= COLUMN_ORDER.indexOf(columnName)) return
    await rest('PATCH', `wk_contacts?id=eq.${contactId}`, { pipeline_column_id: target })
  } catch (e) { console.error('moveCard:', e.message) }
}

async function heartbeat(current) {
  try {
    await rest('POST', 'platform_settings?on_conflict=key', [{
      key: 'vsl_render_worker',
      value: JSON.stringify({ last_seen: new Date().toISOString(), current }),
      updated_at: new Date().toISOString(),
    }], { Prefer: 'resolution=merge-duplicates' })
  } catch (e) { console.error('heartbeat:', e.message) }
}

async function requeueStale() {
  const cutoff = new Date(Date.now() - STALE_MIN * 60_000).toISOString()
  try {
    await rest('PATCH', `wk_vsl_pages?render_status=eq.rendering&render_started_at=lt.${cutoff}`, {
      render_status: 'queued', render_error: 'requeued: worker restarted mid-render',
    })
  } catch (e) { console.error('requeueStale:', e.message) }
}

async function claim() {
  const rows = await rest('GET', 'wk_vsl_pages?render_status=eq.queued&order=render_requested_at.asc.nullsfirst&limit=1&select=*')
  if (!rows?.length) return null
  const page = rows[0]
  // atomic: only wins if still queued
  const won = await rest('PATCH',
    `wk_vsl_pages?id=eq.${page.id}&render_status=eq.queued`,
    { render_status: 'rendering', render_started_at: new Date().toISOString(), render_error: null },
    { Prefer: 'return=representation' })
  return won?.length ? won[0] : null
}

async function upload(localPath, remoteName, contentType) {
  const buf = readFileSync(localPath)
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${remoteName}`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: buf,
  })
  if (!res.ok) throw new Error(`upload ${remoteName}: ${res.status} ${await res.text()}`)
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${remoteName}`
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts })
}

async function renderOne(page) {
  const slug = page.slug
  console.log(`[${new Date().toISOString()}] rendering ${slug} (contact ${page.contact_id})`)
  await moveCard(page.contact_id, 'Rendering')
  await heartbeat(slug)

  const outDir = join(VIDEO, 'out', 'leads')
  mkdirSync(outDir, { recursive: true })
  const mp4 = join(outDir, `${slug}.mp4`)
  const jpg = join(outDir, `${slug}.jpg`)

  // 1. prep — writes lead-gen.json (+ capture); loud failures propagate
  run('node', [join(VIDEO, 'scripts', 'prep-lead.mjs'), page.contact_id], { cwd: REPO, timeout: 300_000 })
  const gen = JSON.parse(readFileSync(join(VIDEO, 'src', 'data', 'lead-gen.json'), 'utf8'))

  // 2. render (the long part)
  run('npx', ['remotion', 'render', 'src/index.ts', 'FlowVideo', mp4, '--codec=h264', '--concurrency=8'],
    { cwd: VIDEO, timeout: 45 * 60_000 })
  if (!existsSync(mp4)) throw new Error('render produced no file')

  // 3. poster from frame 0
  run('ffmpeg', ['-y', '-i', mp4, '-frames:v', '1', '-q:v', '4', jpg], { timeout: 60_000 })

  // 4. upload
  const videoUrl = await upload(mp4, `${slug}.mp4`, 'video/mp4')
  const posterUrl = await upload(jpg, `${slug}.jpg`, 'image/jpeg')

  // 5. flip the row — the board's realtime subscription shows it instantly
  await rest('PATCH', `wk_vsl_pages?id=eq.${page.id}`, {
    render_status: 'ready',
    render_done_at: new Date().toISOString(),
    video_url: videoUrl,
    poster_url: posterUrl,
    no_website: !!gen.no_website,
    render_error: null,
  })
  await moveCard(page.contact_id, 'Ready to send')
  console.log(`[${new Date().toISOString()}] READY ${slug} → ${videoUrl}`)

  // 6. leave the repo clean for the next lead
  try { run('git', ['checkout', '--', 'video/src/data/lead-gen.json'], { cwd: REPO }) } catch { /* fine */ }
}

async function tick() {
  await heartbeat(null)
  await requeueStale()
  const page = await claim()
  if (!page) return
  try {
    await renderOne(page)
  } catch (e) {
    const msg = String(e.stderr || e.message || e).slice(0, 500)
    console.error(`FAILED ${page.slug}:`, msg)
    try {
      await rest('PATCH', `wk_vsl_pages?id=eq.${page.id}`, { render_status: 'failed', render_error: msg })
    } catch (e2) { console.error('mark-failed also failed:', e2.message) }
    try { run('git', ['checkout', '--', 'video/src/data/lead-gen.json'], { cwd: REPO }) } catch { /* fine */ }
  }
}

console.log(`vsl-render-worker up — repo ${REPO}, poll ${POLL_MS / 1000}s`)
for (;;) {
  await tick().catch((e) => console.error('tick:', e.message))
  await new Promise((r) => setTimeout(r, POLL_MS))
}

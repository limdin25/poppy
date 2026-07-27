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

import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs'
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
// Renders observed at 6 to 8 minutes, so 25 is a threefold margin and still
// rescues a stuck row three times faster than the old 45. The worker is single
// threaded, so requeueing cannot start a second render of the same page.
const STALE_MIN = 25
const BUCKET = 'vsl-videos'

// KEEP IN LOCKSTEP with api/lib/vsl-settings.ts
const COLUMN_ORDER = [
  'Rendering', 'Ready to send', 'Video sent', 'Opened page', 'Watched video',
  'Clicked button', 'Checkout started', 'Paid',
]

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const HJ = { ...H, 'Content-Type': 'application/json' }

/**
 * Every call this worker makes to Supabase, with a short retry.
 *
 * Rendering pins the CPU for minutes at a time (chromium + ffmpeg), and under
 * that load a request can simply time out. On 2026-07-27 that produced
 * "mark-failed also failed: fetch failed": the render died, and the write
 * recording that it died died too, so the row sat at 'rendering' until
 * requeueStale noticed 45 minutes later and an agent stared at a frozen card.
 *
 * A transport failure or a 5xx is worth another go. A 4xx is Supabase telling
 * us something true, so that throws immediately.
 */
async function rest(method, path, body, headers = {}) {
  const waits = [500, 2000, 6000]
  let lastErr = null
  for (let i = 0; i <= waits.length; i++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method, headers: { ...HJ, ...headers }, body: body ? JSON.stringify(body) : undefined,
      })
      if (res.status >= 500) {
        lastErr = new Error(`${method} ${path}: ${res.status}`)
      } else {
        if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
        const text = await res.text()
        return text ? JSON.parse(text) : null
      }
    } catch (e) {
      // A 4xx we raised above must not be retried.
      if (/: 4\d\d/.test(e.message || '')) throw e
      lastErr = e
    }
    if (i < waits.length) await new Promise((r) => setTimeout(r, waits[i]))
  }
  throw lastErr
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

/**
 * Node's global fetch reports every transport failure as the same three words,
 * "fetch failed", and hides the real reason on `error.cause`. Gas First Ltd
 * failed five times on 2026-07-27 with nothing but those three words in
 * render_error, and prep, render and upload all worked when run by hand. Hours
 * went into guessing because the message named neither the step nor the cause.
 *
 * So: never let a bare "fetch failed" reach the row again.
 */
function why(e) {
  const parts = [e?.message || String(e)]
  let c = e?.cause
  for (let i = 0; c && i < 3; i++) {
    const bit = [c.code, c.message].filter(Boolean).join(' ')
    if (bit) parts.push(bit)
    c = c.cause
  }
  return parts.join(' <- ')
}

/** A 45 MB upload over a link we do not control, at the END of a ten-minute
 *  render. Losing that to one dropped socket is the worst possible trade, and
 *  it was a single unguarded attempt. A 4xx is the server telling us something
 *  true (too big, bad auth) so it fails immediately; transport blips retry. */
async function upload(localPath, remoteName, contentType) {
  const buf = readFileSync(localPath)
  const waits = [2000, 8000, 20000]
  let lastErr = null
  for (let i = 0; i <= waits.length; i++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${remoteName}`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': contentType, 'x-upsert': 'true' },
        body: buf,
      })
      if (res.ok) return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${remoteName}`
      const text = (await res.text()).slice(0, 300)
      // 413 arrives as a 400 with statusCode 413 in the body. Either way the
      // file is too big for the project limit and retrying cannot help.
      if (res.status < 500) throw new Error(`upload ${remoteName}: ${res.status} ${text}`)
      lastErr = new Error(`upload ${remoteName}: ${res.status} ${text}`)
    } catch (e) {
      if (/upload .*: 4\d\d/.test(e.message || '')) throw e
      lastErr = new Error(`upload ${remoteName}: ${why(e)}`)
    }
    if (i < waits.length) {
      console.error(`${lastErr.message} — retrying in ${waits[i] / 1000}s`)
      await new Promise((r) => setTimeout(r, waits[i]))
    }
  }
  throw lastErr
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts })
}

async function renderOne(page) {
  const slug = page.slug
  console.log(`[${new Date().toISOString()}] rendering ${slug} (contact ${page.contact_id})`)
  await moveCard(page.contact_id, 'Rendering')
  await heartbeat(slug)
  // A render is 5–10 min of blocking work; without a pulse the admin panel
  // declares the worker dead after 120s (adversarial review #4). Beat every
  // 30s while rendering.
  const pulse = setInterval(() => { heartbeat(slug).catch(() => {}) }, 30_000)

  const outDir = join(VIDEO, 'out', 'leads')
  mkdirSync(outDir, { recursive: true })
  const mp4 = join(outDir, `${slug}.mp4`)
  const jpg = join(outDir, `${slug}.jpg`)

  try {
    // Which step we are on, so a failure names it. "fetch failed" on its own
    // could be prep, the upload of the video, the upload of the poster or the
    // row update, and they need completely different fixes.
    page.__stage = 'prep'
    // 1. prep — writes lead-gen.json (+ capture); loud failures propagate
    run('node', [join(VIDEO, 'scripts', 'prep-lead.mjs'), page.contact_id], { cwd: REPO, timeout: 300_000 })

    page.__stage = 'render'
    // 2. render (the long part)
    run('npx', ['remotion', 'render', 'src/index.ts', 'FlowVideo', mp4, '--codec=h264', '--concurrency=8'],
      { cwd: VIDEO, timeout: 45 * 60_000 })
    if (!existsSync(mp4)) throw new Error('render produced no file')

    // 3. poster — the PosterV 16:9 still (site or Google card behind the
    //    actor; frame 90 = the vetted actor pose). lead-gen.json is still
    //    this lead's here. Fall back to frame 0 so a poster hiccup never
    //    throws away a finished 10-minute render.
    try {
      run('npx', ['remotion', 'still', 'src/index.ts', 'PosterV', jpg, '--frame=90'],
        { cwd: VIDEO, timeout: 5 * 60_000 })
    } catch (e) {
      console.error('PosterV still failed, using frame 0:', String(e.stderr || e.message).slice(0, 300))
      run('ffmpeg', ['-y', '-i', mp4, '-frames:v', '1', '-q:v', '4', jpg], { timeout: 60_000 })
    }

    page.__stage = 'upload-video'
    // 4. upload
    const videoUrl = await upload(mp4, `${slug}.mp4`, 'video/mp4')
    page.__stage = 'upload-poster'
    const posterUrl = await upload(jpg, `${slug}.jpg`, 'image/jpeg')
    page.__stage = 'save'

    // 5. flip the row — the board's realtime subscription shows it instantly.
    //    no_website is owned by the API at page-create (source of truth) — the
    //    worker must NOT overwrite it, or a retry could break the promise trail
    //    on an already-texted page (#19).
    //    ?v= busts the storage CDN on re-renders (same object name is upserted).
    const bust = Date.now()
    await rest('PATCH', `wk_vsl_pages?id=eq.${page.id}`, {
      render_status: 'ready',
      render_done_at: new Date().toISOString(),
      video_url: `${videoUrl}?v=${bust}`,
      poster_url: `${posterUrl}?v=${bust}`,
      render_error: null,
    })
    await moveCard(page.contact_id, 'Ready to send')
    console.log(`[${new Date().toISOString()}] READY ${slug} → ${videoUrl}`)
  } finally {
    clearInterval(pulse)
    // 6. reclaim disk — the bucket is the system of record now (#5)
    rmSync(mp4, { force: true })
    rmSync(jpg, { force: true })
    // leave the repo clean for the next lead
    try { run('git', ['checkout', '--', 'video/src/data/lead-gen.json'], { cwd: REPO }) } catch { /* fine */ }
  }
}

async function tick() {
  await heartbeat(null)
  await requeueStale()
  const page = await claim()
  if (!page) return
  try {
    await renderOne(page)
  } catch (e) {
    const msg = `[${page.__stage || 'start'}] ${String(e.stderr || why(e)).slice(0, 460)}`
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

// Shared website-URL safety + classification for the render pipeline.
// Used by prep-lead.mjs (gate before spawning the capture) and
// capture-mobile-site.mjs (defence in depth at the browser). The API mirrors
// isCapturableWebsite in api/crm/vsl-page.ts — keep the two in lockstep so the
// SMS variant (no_website) matches the video scene.

// Social / directory hosts are NOT "their website" — a lead whose only link is
// Facebook gets the no-website treatment (search scene + free-website offer).
const SOCIAL = /(^|\.)(facebook|fb|instagram|twitter|x|linktr|linkedin|tiktok|youtube|youtu|wa|whatsapp|yell|checkatrade|trustpilot|google|bark|thomsonlocal|freeindex)\b/i

// Private / loopback / link-local / metadata — never let a root headless
// browser fetch these (SSRF). We block by literal too; DNS-rebinding is a
// residual risk accepted for now (documented).
function isBlockedHost(host) {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h === 'metadata' || h === 'metadata.google.internal') return true
  // IPv4 literal?
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true          // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
    if (a === 192 && b === 168) return true          // 192.168/16
    if (a >= 224) return true                        // multicast / reserved
    return false
  }
  // IPv6 literal (loopback / ULA / link-local)
  if (h.includes(':')) {
    if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true
    return true // bare IPv6 host for a plumber's site = almost certainly an attack
  }
  // must look like a real public domain: has a dot and a 2+ char TLD
  if (!/\.[a-z]{2,}$/i.test(h)) return true
  return false
}

/** Normalise a raw website value to an https URL, or null if it isn't a safe,
 *  capturable public website (social/junk/private all return null). */
export function safeWebsiteUrl(raw) {
  const v = String(raw || '').trim()
  if (!v) return null
  let url
  try {
    url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (url.port && !['', '80', '443'].includes(url.port)) return null // no odd internal ports
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (SOCIAL.test(host)) return null
  if (['g.page', 'g.co', 'goo.gl', 'maps.app.goo.gl', 'business.site'].includes(host) || host.endsWith('.business.site')) return null
  if (isBlockedHost(host)) return null
  url.protocol = 'https:'
  return url.toString()
}

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Hugo 2026-07-24: full end-to-end audit of every cold call, published at /report
// behind access code 1176 so he can read it (and later send each agent their tab).

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')
const route = read('api/report.ts')
const vercel = JSON.parse(read('vercel.json')) as { rewrites: Array<{ source: string; destination: string }> }

describe('/report — the audit page', () => {
  it('is reachable at /report via a rewrite that beats the SPA catch-all', () => {
    const i = vercel.rewrites.findIndex((r) => r.source === '/report')
    const spa = vercel.rewrites.findIndex((r) => r.destination === '/index.html')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(vercel.rewrites[i].destination).toBe('/api/report')
    expect(i).toBeLessThan(spa)
  })

  it('is gated by the access code and never serves the report without it', () => {
    expect(route).toMatch(/PASSWORD = '1176'/)
    // the report body is only reachable through the cookie check
    expect(route).toMatch(/authed \? REPORT_HTML : LOGIN_PAGE/)
  })

  it('does not put the raw password in the cookie', () => {
    expect(route).not.toMatch(/COOKIE_OK = '1176'/)
    expect(route).toMatch(/HttpOnly; Secure/)
  })

  it('uses the Node (req, res) handler shape, not the edge Request API', () => {
    // Edge signature type-checks but throws at runtime on the Node runtime —
    // same trap as daily-agent-reports, caught in production 2026-07-24.
    expect(route).not.toMatch(/req\.headers\.get\(/)
    expect(route).not.toMatch(/runtime: 'edge'/)
    expect(route).toMatch(/ServerResponse/)
  })

  it('is hidden from search engines', () => {
    expect(route).toMatch(/X-Robots-Tag/)
    expect(route).toMatch(/noindex/)
  })
})

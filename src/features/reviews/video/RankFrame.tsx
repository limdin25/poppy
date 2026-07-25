import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

// RankFrame — the internal "Google local results" surface, styled like Google,
// populated with the lead's REAL stats + the LIVE local pack for their town.
// It is never served publicly as Google: it's the render surface the video is
// filmed from (headless scroll + voiceover). URL: /rank-frame?contact=<id>.
//
// Everything is inline-styled on purpose: the video renderer loads this page in
// a headless browser and must get pixel-identical output regardless of the app's
// Tailwind build. No app chrome, no auth — just the frame.

interface PackEntry {
  name: string
  rating: number | null
  reviews: number | null
  isLead: boolean
}
interface Lead {
  business: string
  owner: string
  town: string
  rating: number | null
  reviews: number | null
  rank: number | null
  plumbers_ahead: number | null
  total_plumbers: number | null
}

// Sample so the frame always renders (no contact id / offline preview).
const SAMPLE_LEAD: Lead = {
  business: 'James Plumbing And Drainage Ltd', owner: 'James', town: 'Manchester',
  rating: 4.9, reviews: 41, rank: 12, plumbers_ahead: 11, total_plumbers: 120,
}
const SAMPLE_PACK: PackEntry[] = [
  { name: 'Manchester Plumbing & Heating', rating: 4.9, reviews: 612, isLead: false },
  { name: 'Rapid Response Plumbers', rating: 4.8, reviews: 488, isLead: false },
  { name: 'City Drainage Experts', rating: 5.0, reviews: 377, isLead: false },
  { name: 'Northern Gas & Plumbing', rating: 4.9, reviews: 306, isLead: false },
  { name: 'AquaFix Emergency Plumbers', rating: 4.7, reviews: 254, isLead: false },
  { name: 'Trafford Plumbing Co', rating: 4.8, reviews: 201, isLead: false },
  { name: 'Salford Heating Services', rating: 4.9, reviews: 176, isLead: false },
  { name: 'Didsbury Plumbers', rating: 4.8, reviews: 143, isLead: false },
  { name: 'Prestwich Drain Care', rating: 4.9, reviews: 118, isLead: false },
  { name: 'Eccles Plumbing Solutions', rating: 4.7, reviews: 96, isLead: false },
  { name: 'Chorlton Gas Safe', rating: 4.8, reviews: 74, isLead: false },
  { name: 'James Plumbing And Drainage Ltd', rating: 4.9, reviews: 41, isLead: true },
  { name: 'Urmston Pipe & Tap', rating: 4.9, reviews: 33, isLead: false },
  { name: 'Whalley Range Plumbers', rating: 5.0, reviews: 21, isLead: false },
]

const PER_PAGE = 7

function Stars({ rating }: { rating: number | null }) {
  const r = rating ?? 0
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ color: '#e7711b', fontSize: 14, fontWeight: 700 }}>{r ? r.toFixed(1) : '—'}</span>
      <span style={{ letterSpacing: 1 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} style={{ color: i < Math.round(r) ? '#fbbc04' : '#dadce0', fontSize: 15 }}>★</span>
        ))}
      </span>
    </span>
  )
}

function ResultRow({ e, position }: { e: PackEntry; position: number }) {
  return (
    <div
      style={{
        display: 'flex', gap: 14, padding: '18px 16px', borderRadius: 12,
        background: e.isLead ? '#fce8e6' : '#fff',
        border: e.isLead ? '2px solid #d93025' : '1px solid #ebebeb',
        marginBottom: 12, position: 'relative',
      }}
    >
      <div
        style={{
          flex: '0 0 34px', height: 34, borderRadius: '50%', background: e.isLead ? '#d93025' : '#f1f3f4',
          color: e.isLead ? '#fff' : '#5f6368', fontWeight: 700, fontSize: 15,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {position}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18, color: e.isLead ? '#202124' : '#1a0dab', fontWeight: e.isLead ? 700 : 500 }}>
            {e.name}
          </span>
          {e.isLead && (
            <span style={{ background: '#d93025', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>
              YOU
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <Stars rating={e.rating} />
          <span style={{ color: '#70757a', fontSize: 14 }}>
            ({e.reviews ?? 0}) · Plumber
          </span>
        </div>
        <div style={{ color: '#70757a', fontSize: 13, marginTop: 6 }}>
          Open now · On-site estimates · Emergency service
        </div>
      </div>
    </div>
  )
}

export default function RankFrame() {
  const [params] = useSearchParams()
  const contact = params.get('contact')
  const [lead, setLead] = useState<Lead>(SAMPLE_LEAD)
  const [pack, setPack] = useState<PackEntry[]>(SAMPLE_PACK)
  const [loading, setLoading] = useState(!!contact)

  useEffect(() => {
    if (!contact) return
    let live = true
    setLoading(true)
    fetch(`/api/leads/rank-frame?contact=${encodeURIComponent(contact)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!live || !d?.ok) return
        setLead(d.lead)
        setPack(d.pack)
      })
      .catch(() => {})
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [contact])

  const leadIndex = useMemo(() => pack.findIndex((p) => p.isLead), [pack])
  const leadPage = leadIndex >= 0 ? Math.floor(leadIndex / PER_PAGE) + 1 : null
  const query = `plumbers in ${lead.town || '…'}`

  const pages = useMemo(() => {
    const out: PackEntry[][] = []
    for (let i = 0; i < pack.length; i += PER_PAGE) out.push(pack.slice(i, i + PER_PAGE))
    return out
  }, [pack])

  return (
    <div style={{ background: '#fff', minHeight: '100vh', fontFamily: 'Arial, Roboto, sans-serif', color: '#202124' }}>
      {/* Google-style top bar */}
      <div style={{ borderBottom: '1px solid #ebebeb', padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 24 }}>
        <span style={{ fontSize: 26, fontWeight: 500 }}>
          <span style={{ color: '#4285f4' }}>G</span><span style={{ color: '#ea4335' }}>o</span>
          <span style={{ color: '#fbbc05' }}>o</span><span style={{ color: '#4285f4' }}>g</span>
          <span style={{ color: '#34a853' }}>l</span><span style={{ color: '#ea4335' }}>e</span>
        </span>
        <div
          style={{
            flex: 1, maxWidth: 640, display: 'flex', alignItems: 'center', gap: 10,
            border: '1px solid #dfe1e5', borderRadius: 24, padding: '10px 18px',
            boxShadow: '0 1px 6px rgba(32,33,36,.12)',
          }}
        >
          <span style={{ color: '#4285f4', fontSize: 16 }}>🔍</span>
          <span style={{ fontSize: 16, color: '#202124' }}>{query}</span>
        </div>
      </div>
      {/* tabs */}
      <div style={{ display: 'flex', gap: 28, padding: '10px 28px', borderBottom: '1px solid #ebebeb', color: '#5f6368', fontSize: 13 }}>
        {['All', 'Maps', 'Images', 'News', 'Shopping'].map((t, i) => (
          <span key={t} style={{ color: i === 1 ? '#1a73e8' : '#5f6368', borderBottom: i === 1 ? '3px solid #1a73e8' : 'none', paddingBottom: 8 }}>
            {t}
          </span>
        ))}
      </div>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px 120px' }}>
        <div style={{ color: '#70757a', fontSize: 13, marginBottom: 4 }}>
          About {lead.total_plumbers ?? pack.length} results
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 2 }}>
          Plumbers near {lead.town || 'you'}
        </div>
        {leadPage && (
          <div style={{ color: '#d93025', fontSize: 14, fontWeight: 700, margin: '6px 0 16px' }}>
            {lead.business} shows up on page {leadPage} — after {leadIndex} competitors.
          </div>
        )}

        {pages.map((rows, pi) => (
          <div key={pi}>
            {pi > 0 && (
              <div style={{ textAlign: 'center', color: '#70757a', fontSize: 13, margin: '24px 0 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ flex: 1, height: 1, background: '#ebebeb' }} />
                Page {pi + 1}
                <span style={{ flex: 1, height: 1, background: '#ebebeb' }} />
              </div>
            )}
            {rows.map((e, ri) => (
              <ResultRow key={pi * PER_PAGE + ri} e={e} position={pi * PER_PAGE + ri + 1} />
            ))}
          </div>
        ))}

        {loading && <div style={{ color: '#70757a', fontSize: 13, textAlign: 'center', marginTop: 20 }}>Loading live results…</div>}
      </div>
    </div>
  )
}

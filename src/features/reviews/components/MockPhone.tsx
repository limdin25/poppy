// Reusable iPhone-style mock used by the Messaging page to preview outgoing
// review requests + follow-up threads. Pixel specs are fixed (280×560 body,
// notch, status bar, battery) so every preview looks identical.
import { useEffect, useState } from 'react'
import { cn } from '@/core/lib/cn'

export interface PhoneMessage {
  id: string
  kind: 'image' | 'outgoing' | 'incoming'
  text?: string
  imageUrl?: string
  /** Overlay the recipient's first name on an image bubble (e.g. "Jessica!"). */
  imageOverlay?: { text: string; xPct: number; yPct: number; color: string }
  time?: string
}

function Battery() {
  return (
    <div className="flex items-center gap-0.5">
      <div className="relative flex h-2.5 w-5 items-center rounded-sm border border-gray-800 p-[1px]">
        <div className="h-full w-[70%] rounded-[1px] bg-gray-800" />
      </div>
      <div className="h-1 w-0.5 rounded-r bg-gray-800" />
    </div>
  )
}

export function MockPhone({ time = '9:41', messages }: { time?: string; messages: PhoneMessage[] }) {
  const [shown, setShown] = useState(false)
  useEffect(() => { const t = setTimeout(() => setShown(true), 50); return () => clearTimeout(t) }, [])

  return (
    <div className="relative mx-auto h-[560px] w-[280px] rounded-[40px] bg-black p-3 shadow-xl">
      <div className="absolute left-1/2 top-0 z-10 h-7 w-32 -translate-x-1/2 rounded-b-2xl bg-black" />
      <div className="relative h-full w-full overflow-hidden rounded-[32px] bg-gray-100">
        {/* Status bar */}
        <div className="flex h-8 items-center justify-between px-6 pt-1">
          <span className="text-xs font-medium text-gray-900">{time}</span>
          <Battery />
        </div>
        {/* Messages */}
        <div className="h-[calc(100%-32px)] overflow-y-auto p-3">
          <div className="flex flex-col gap-3">
            {messages.map((m, i) => (
              <div
                key={m.id}
                className={cn(
                  'flex transform flex-col transition-all duration-500',
                  m.kind === 'incoming' ? 'items-start' : 'items-end',
                  shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
                )}
                style={{ transitionDelay: `${i * 120}ms` }}
              >
                {m.kind === 'image' ? (
                  <div className="relative">
                    <img src={m.imageUrl} alt="Personalised" className="max-w-[200px] rounded-2xl rounded-tr-md shadow-sm" />
                    {m.imageOverlay && (
                      <span
                        className="pointer-events-none absolute text-xl font-black"
                        style={{
                          left: `${m.imageOverlay.xPct}%`, top: `${m.imageOverlay.yPct}%`,
                          // Anchor the text baseline (bottom) at name_y, matching the
                          // server renderer which treats name_y as the glyph baseline.
                          transform: 'translate(-50%, -100%)',
                          color: m.imageOverlay.color, textShadow: '0 1px 4px rgba(0,0,0,0.55)',
                        }}
                      >
                        {m.imageOverlay.text}
                      </span>
                    )}
                  </div>
                ) : (
                  <div
                    className={cn(
                      'max-w-[220px] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm',
                      m.kind === 'outgoing' ? 'rounded-tr-md bg-blue-500 text-white' : 'rounded-tl-md bg-gray-200 text-gray-800',
                    )}
                  >
                    {m.text}
                  </div>
                )}
                {m.time && <span className="px-1 pt-0.5 text-[10px] text-gray-400">{m.time}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

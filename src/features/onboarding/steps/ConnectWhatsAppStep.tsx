import { useEffect, useState } from 'react'
import { MessageCircle, CheckCircle2, Loader2, ExternalLink, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/integrations/supabase/browser'

export default function ConnectWhatsAppStep() {
  const { businessId, session } = useAuth()
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [opened, setOpened] = useState(false)

  async function checkConnected() {
    if (!businessId) return
    const { data } = await supabase
      .from('channels')
      .select('status')
      .eq('business_id', businessId)
      .eq('type', 'whatsapp')
      .eq('status', 'connected')
      .maybeSingle()
    setConnected(!!data)
  }

  useEffect(() => {
    checkConnected()
    // Poll while the hosted link is open in the other tab
    const t = setInterval(checkConnected, 4000)
    return () => clearInterval(t)
  }, [businessId])

  async function connect() {
    if (!businessId || !session) return
    setConnecting(true)
    try {
      const res = await fetch('/api/channels/whatsapp/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ businessId, provider: 'WHATSAPP' }),
      })
      const data = await res.json()
      if (data.error) {
        alert(data.error)
      } else if (data.url) {
        window.open(data.url, '_blank')
        setOpened(true)
      }
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-ink">Connect WhatsApp</h2>
      <p className="mt-2 text-[15px] text-ink-muted">
        This is the last step. Link your WhatsApp so Elsie can read and reply to your customers.
        No rush — you can do this now or later from Settings.
      </p>

      {connected ? (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-success/10">
            <CheckCircle2 size={22} className="text-success" />
          </div>
          <div>
            <p className="text-[14px] font-semibold text-ink">WhatsApp connected</p>
            <p className="text-[12px] text-ink-muted">Elsie is now watching your inbox. You're all set.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-6 rounded-xl border border-border bg-surface p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50">
                <MessageCircle size={22} className="text-emerald-600" />
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-medium text-ink">WhatsApp Business</p>
                <p className="text-[12px] text-ink-muted">You'll scan a QR code with your phone — takes ~30 seconds.</p>
              </div>
            </div>

            <button
              onClick={connect}
              disabled={connecting}
              className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand text-[14px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
            >
              {connecting ? (
                <><Loader2 size={16} className="animate-spin" /> Opening…</>
              ) : opened ? (
                <><ExternalLink size={16} /> Reopen WhatsApp setup</>
              ) : (
                <><MessageCircle size={16} /> Connect WhatsApp</>
              )}
            </button>

            {opened && (
              <p className="mt-3 text-center text-[12px] text-ink-muted">
                Finish scanning in the new tab — this page updates automatically once connected.
              </p>
            )}
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-lg bg-elevated px-3 py-2.5 text-[12px] text-ink-muted">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-ink-subtle" />
            <span>We never message anyone without your say-so. You stay in control of every reply.</span>
          </div>
        </>
      )}
    </div>
  )
}

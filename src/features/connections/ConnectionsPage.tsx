import { useState } from 'react'
import { Phone, MessageCircle, MessageSquare, Camera, Mail, Plus, Loader2, Link2Off } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { useSupabaseQuery, supabase } from '@/core/hooks/useSupabaseQuery'
import type { Channel, Agent } from '@/core/types/database'

const TYPE_CONFIG: Record<string, { icon: typeof Phone; label: string; color: string }> = {
  voice: { icon: Phone, label: 'Phone', color: 'text-blue-600 bg-blue-50' },
  whatsapp: { icon: MessageCircle, label: 'WhatsApp', color: 'text-emerald-600 bg-emerald-50' },
  sms: { icon: MessageSquare, label: 'SMS', color: 'text-purple-600 bg-purple-50' },
  instagram: { icon: Camera, label: 'Instagram', color: 'text-pink-600 bg-pink-50' },
  email_gmail: { icon: Mail, label: 'Email (Gmail)', color: 'text-red-600 bg-red-50' },
  email_outlook: { icon: Mail, label: 'Email (Outlook)', color: 'text-blue-600 bg-blue-50' },
  email_smtp: { icon: Mail, label: 'Email (SMTP)', color: 'text-orange-600 bg-orange-50' },
}

const CHANNEL_GROUPS = ['voice', 'whatsapp', 'sms', 'instagram', 'email_gmail', 'email_outlook', 'email_smtp']

export default function ConnectionsPage() {
  const { businessId } = useAuth()
  const { data: channels, loading, refetch } = useSupabaseQuery<Channel>(
    () => supabase.from('channels').select('*').eq('business_id', businessId!).order('created_at'),
    [businessId]
  )
  const { data: agents } = useSupabaseQuery<Agent>(
    () => supabase.from('agents').select('*').eq('business_id', businessId!).order('sort_order'),
    [businessId]
  )
  const [assigning, setAssigning] = useState<string | null>(null)

  async function assignAgent(channelId: string, agentId: string | null) {
    setAssigning(channelId)
    await supabase.from('channels').update({ agent_id: agentId }).eq('id', channelId)
    refetch()
    setAssigning(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-ink-muted" />
      </div>
    )
  }

  const grouped = CHANNEL_GROUPS.reduce<Record<string, Channel[]>>((acc, type) => {
    const matches = channels.filter(c => c.type === type)
    if (matches.length > 0) acc[type] = matches
    return acc
  }, {})

  const hasChannels = Object.keys(grouped).length > 0

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Connections</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            Manage your connected channels and assign agents to each one.
          </p>
        </div>
        <button className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-white transition hover:bg-brand-600">
          <Plus size={14} />
          Add Channel
        </button>
      </div>

      {!hasChannels ? (
        <div className="mt-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-elevated">
            <Link2Off size={28} className="text-ink-subtle" />
          </div>
          <h2 className="mt-4 text-[15px] font-semibold text-ink">No channels connected</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            Connect a phone number, WhatsApp, Instagram, or email to get started.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {Object.entries(grouped).map(([type, typeChannels]) => {
            const config = TYPE_CONFIG[type]
            if (!config) return null
            const Icon = config.icon

            return (
              <div key={type}>
                <div className="mb-2 flex items-center gap-2">
                  <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg', config.color)}>
                    <Icon size={14} />
                  </div>
                  <h2 className="text-[14px] font-semibold text-ink">{config.label}</h2>
                </div>

                <div className="space-y-2">
                  {typeChannels.map(channel => {
                    return (
                      <div
                        key={channel.id}
                        className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 shadow-soft"
                      >
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            'h-2 w-2 rounded-full',
                            channel.status === 'connected' ? 'bg-emerald-500' : 'bg-red-400'
                          )} />
                          <div>
                            <p className="text-[14px] font-medium text-ink">
                              {channel.label || channel.unipile_account_id || 'Connected'}
                            </p>
                            <p className="text-[12px] text-ink-muted">
                              {channel.status === 'connected' ? 'Active' : channel.status}
                              {channel.connected_at && ` since ${new Date(channel.connected_at).toLocaleDateString()}`}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <select
                            value={channel.agent_id || ''}
                            onChange={(e) => assignAgent(channel.id, e.target.value || null)}
                            disabled={assigning === channel.id}
                            className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-ink focus:border-brand focus:outline-none"
                          >
                            <option value="">No agent</option>
                            {agents.map(agent => (
                              <option key={agent.id} value={agent.id}>{agent.name}</option>
                            ))}
                          </select>
                          {assigning === channel.id && <Loader2 size={14} className="animate-spin text-ink-muted" />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

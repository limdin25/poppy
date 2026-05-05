import { useState } from 'react'
import { Search, Plus, Phone, Mail, MessageSquare, ArrowLeft, MoreHorizontal, Calendar } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { Avatar } from '@/core/ui/Avatar'
import { EmptyState } from '@/core/ui/EmptyState'
import { useContacts } from '@/core/hooks/useContacts'
import type { Contact } from '@/core/types/database'

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return 'Today'
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return 'Today'
  if (hrs < 48) return 'Yesterday'
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days} days ago`
  return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''} ago`
}

export default function ContactsPage() {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data: contacts, loading } = useContacts()

  const selected = contacts.find((c) => c.id === selectedId)

  const filtered = contacts.filter((c) => {
    const q = search.toLowerCase()
    return (
      (c.name?.toLowerCase().includes(q) ?? false) ||
      (c.phone?.includes(q) ?? false) ||
      (c.email?.toLowerCase().includes(q) ?? false)
    )
  })

  if (selected && typeof window !== 'undefined' && window.innerWidth < 1024) {
    return (
      <div className="flex h-full flex-col">
        <ContactDetail contact={selected} onBack={() => setSelectedId(null)} />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <div className={cn('flex w-full flex-col border-r border-border lg:w-[300px] lg:shrink-0', selected && 'hidden lg:flex')}>
        <div className="flex items-center justify-between px-4 pt-4">
          <h1 className="text-lg font-semibold text-ink">Contacts</h1>
          <button className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-2.5 text-[12px] font-medium text-white transition hover:bg-brand-600">
            <Plus size={13} />
            Add
          </button>
        </div>

        <div className="relative mt-3 px-4">
          <Search size={15} className="absolute left-7 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts..."
            className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>

        <div className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-ink-muted">No contacts yet</p>
          ) : (
            filtered.map((contact) => (
              <button
                key={contact.id}
                onClick={() => setSelectedId(contact.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition',
                  selectedId === contact.id ? 'bg-brand-50 border border-brand/20' : 'hover:bg-elevated border border-transparent'
                )}
              >
                <Avatar name={contact.name ?? 'Unknown'} size="sm" className="border-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="truncate text-[13px] font-medium text-ink">{contact.name ?? 'Unknown'}</p>
                    <span className="text-[10px] text-ink-subtle">{timeAgo(contact.updated_at)}</span>
                  </div>
                  <p className="text-[11px] text-ink-muted">{contact.phone ?? '—'}</p>
                  {contact.tags.length > 0 && (
                    <div className="mt-0.5 flex gap-1">
                      {contact.tags.map((t) => (
                        <span key={t} className="rounded bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="hidden flex-1 lg:flex lg:flex-col">
        {selected ? (
          <ContactDetail contact={selected} onBack={() => setSelectedId(null)} desktop />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<Phone size={24} />}
              title="No contact selected"
              description="Choose a contact from the list to view their details"
            />
          </div>
        )}
      </div>
    </div>
  )
}

function ContactDetail({ contact, onBack, desktop }: { contact: Contact; onBack: () => void; desktop?: boolean }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className={cn('flex-1 overflow-y-auto', desktop ? 'p-5' : 'p-4')}>
        {!desktop && (
          <button onClick={onBack} className="mb-3 flex items-center gap-1.5 text-[13px] text-brand">
            <ArrowLeft size={14} />
            Back
          </button>
        )}

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Avatar name={contact.name ?? 'Unknown'} size="lg" className="border-0" />
            <div>
              <h2 className="text-lg font-semibold text-ink">{contact.name ?? 'Unknown'}</h2>
              {contact.tags.length > 0 && (
                <div className="mt-1 flex gap-1">
                  {contact.tags.map((t) => (
                    <span key={t} className="rounded-md bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">{t}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button className="rounded-md p-1 text-ink-subtle hover:bg-elevated hover:text-ink">
            <MoreHorizontal size={16} />
          </button>
        </div>

        <div className="mt-5 space-y-2.5">
          {contact.phone && (
            <div className="flex items-center gap-2.5 text-[13px]">
              <Phone size={14} className="text-ink-subtle" />
              <span className="text-ink">{contact.phone}</span>
            </div>
          )}
          {contact.email && (
            <div className="flex items-center gap-2.5 text-[13px]">
              <Mail size={14} className="text-ink-subtle" />
              <span className="text-ink">{contact.email}</span>
            </div>
          )}
          <div className="flex items-center gap-2.5 text-[13px]">
            <Calendar size={14} className="text-ink-subtle" />
            <span className="text-ink-muted">Last updated: {timeAgo(contact.updated_at)}</span>
          </div>
        </div>

        {contact.notes && (
          <div className="mt-5">
            <h3 className="text-[13px] font-semibold text-ink">Notes</h3>
            <div className="mt-2 rounded-lg bg-elevated p-3">
              <p className="text-[13px] leading-relaxed text-ink-muted">{contact.notes}</p>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          {contact.phone && (
            <a
              href={`tel:${contact.phone}`}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border text-[12px] font-medium text-ink-muted transition hover:bg-elevated"
            >
              <Phone size={13} />
              Call
            </a>
          )}
          {contact.phone && (
            <a
              href={`sms:${contact.phone}`}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border text-[12px] font-medium text-ink-muted transition hover:bg-elevated"
            >
              <MessageSquare size={13} />
              SMS
            </a>
          )}
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border text-[12px] font-medium text-ink-muted transition hover:bg-elevated"
            >
              <Mail size={13} />
              Email
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

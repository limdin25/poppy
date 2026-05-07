import { useState } from 'react'
import { Calendar, Clock, Phone, Plus, ChevronLeft, ChevronRight, X, Loader2 } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAppointments } from '@/core/hooks/useAppointments'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import type { Appointment } from '@/core/types/database'

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function durationLabel(start: string, end: string) {
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem ? `${hrs}h ${rem}m` : `${hrs} hour${hrs > 1 ? 's' : ''}`
}

const STATUS_STYLES = {
  confirmed: 'bg-success/10 text-success',
  pending: 'bg-warning/10 text-warning',
  completed: 'bg-elevated text-ink-muted',
  cancelled: 'bg-danger/10 text-danger',
  no_show: 'bg-danger/10 text-danger',
}

function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay()
  const offset = firstDay === 0 ? 6 : firstDay - 1
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = Array(offset).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  return cells
}

export default function AppointmentsPage() {
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [calMonth, setCalMonth] = useState(new Date().getMonth())
  const [calYear, setCalYear] = useState(new Date().getFullYear())
  const [showNew, setShowNew] = useState(false)
  const { businessId } = useAuth()
  const { data: appointments, loading, refetch } = useAppointments()

  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1) }
    else setCalMonth(calMonth - 1)
  }
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1) }
    else setCalMonth(calMonth + 1)
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Appointments</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Manage bookings made by Elsie and your team.</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white transition hover:bg-brand-600"
        >
          <Plus size={14} />
          New booking
        </button>
      </div>

      <div className="mt-6 flex items-center gap-2">
        <button
          onClick={() => setView('list')}
          className={cn(
            'rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
            view === 'list' ? 'bg-brand/10 text-brand' : 'text-ink-muted hover:bg-elevated'
          )}
        >
          List
        </button>
        <button
          onClick={() => setView('calendar')}
          className={cn(
            'rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
            view === 'calendar' ? 'bg-brand/10 text-brand' : 'text-ink-muted hover:bg-elevated'
          )}
        >
          Calendar
        </button>
      </div>

      {loading ? (
        <div className="mt-8 flex justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        </div>
      ) : view === 'list' ? (
        appointments.length === 0 ? (
          <p className="mt-8 text-center text-[13px] text-ink-muted">No appointments yet</p>
        ) : (
          <div className="mt-4 space-y-3">
            {appointments.map((appt) => (
              <AppointmentCard key={appt.id} appt={appt} onCancel={refetch} />
            ))}
          </div>
        )
      ) : (
        <div className="mt-4 rounded-xl border border-border bg-surface p-6 shadow-soft">
          <div className="flex items-center justify-between">
            <button onClick={prevMonth} className="text-ink-muted hover:text-ink"><ChevronLeft size={20} /></button>
            <h3 className="text-[16px] font-semibold text-ink">
              {new Date(calYear, calMonth).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
            </h3>
            <button onClick={nextMonth} className="text-ink-muted hover:text-ink"><ChevronRight size={20} /></button>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[12px]">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="py-2 font-medium text-ink-subtle">{d}</div>
            ))}
            {getCalendarDays(calYear, calMonth).map((day, i) => (
              <div key={i} className={cn('rounded-lg py-2 text-[13px]', day ? 'text-ink-muted hover:bg-elevated' : '')}>
                {day ?? ''}
              </div>
            ))}
          </div>
          {appointments.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-[12px] font-medium text-ink-subtle">Upcoming</p>
              {appointments.slice(0, 3).map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded-lg bg-elevated px-3 py-2 text-[13px]">
                  <div className="h-2 w-2 rounded-full bg-brand" />
                  <span className="font-medium text-ink">{formatTime(a.starts_at)}</span>
                  <span className="text-ink-muted">{a.contact?.name ?? 'Unknown'} — {a.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showNew && businessId && (
        <NewBookingModal
          businessId={businessId}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refetch() }}
        />
      )}
    </div>
  )
}

function NewBookingModal({ businessId, onClose, onCreated }: { businessId: string; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [contactName, setContactName] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!title.trim() || !date || !time) return
    setSaving(true)
    const startsAt = new Date(`${date}T${time}`).toISOString()
    const endsAt = new Date(new Date(`${date}T${time}`).getTime() + 60 * 60 * 1000).toISOString()

    await supabase.from('appointments').insert({
      business_id: businessId,
      title: title.trim(),
      starts_at: startsAt,
      ends_at: endsAt,
      status: 'confirmed',
      booked_via: 'manual',
      description: contactName.trim() ? `Contact: ${contactName}` : null,
    })
    setSaving(false)
    onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-pop" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">New Booking</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X size={18} /></button>
        </div>
        <div className="mt-4 space-y-3">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Service (e.g. Boiler Service)"
            autoFocus
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand"
          />
          <input
            type="text"
            value={contactName}
            onChange={e => setContactName(e.target.value)}
            placeholder="Customer name (optional)"
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand"
          />
          <div className="flex gap-2">
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none focus:border-brand"
            />
            <input
              type="time"
              value={time}
              onChange={e => setTime(e.target.value)}
              className="h-10 w-28 rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none focus:border-brand"
            />
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="h-10 flex-1 rounded-lg border border-border text-[13px] font-medium text-ink-muted">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim() || !date || !time}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-brand text-[13px] font-semibold text-white disabled:opacity-60"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

function AppointmentCard({ appt, onCancel }: { appt: Appointment; onCancel: () => void }) {
  const contactName = appt.contact?.name ?? 'Unknown'
  const initials = contactName.split(' ').map(n => n[0]).join('').slice(0, 2)

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft transition hover:border-brand/20">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-elevated text-[13px] font-semibold text-ink-muted">
            {initials}
          </div>
          <div>
            <p className="text-[14px] font-medium text-ink">{contactName}</p>
            <p className="text-[13px] text-ink-muted">{appt.title}</p>
          </div>
        </div>
        <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-medium capitalize', STATUS_STYLES[appt.status] ?? STATUS_STYLES.pending)}>
          {appt.status}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-[13px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <Calendar size={14} />
          {formatDate(appt.starts_at)}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock size={14} />
          {formatTime(appt.starts_at)} ({durationLabel(appt.starts_at, appt.ends_at)})
        </span>
      </div>

      {appt.description && (
        <p className="mt-3 rounded-lg bg-elevated px-3 py-2 text-[13px] text-ink-muted">{appt.description}</p>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-ink-subtle">
          {appt.booked_via === 'manual' ? 'Manual booking' : `Booked via ${appt.booked_via ?? 'Elsie'}`}
        </span>
        <div className="flex gap-2">
          {appt.contact?.phone && (
            <a href={`tel:${appt.contact.phone}`} className="flex items-center gap-1 text-[12px] text-brand hover:underline">
              <Phone size={12} /> Call
            </a>
          )}
          {appt.status !== 'cancelled' && appt.status !== 'completed' && (
            <button
              onClick={async () => {
                if (!window.confirm('Cancel this appointment?')) return
                await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', appt.id)
                onCancel()
              }}
              className="text-[12px] text-ink-muted hover:text-danger"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { Search, ChevronLeft, ChevronRight, ArrowUpDown, Phone, MessageSquare, Mail } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import type { ActivityRow } from '../types'

interface Props {
  rows: ActivityRow[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  onPageChange: (page: number) => void
  onSearch: (query: string) => void
  onSort: (col: string, dir: 'asc' | 'desc') => void
  sortCol: string
  sortDir: 'asc' | 'desc'
}

const channelIcon: Record<string, typeof Phone> = {
  voice: Phone,
  whatsapp: MessageSquare,
  email: Mail,
}

const channelColor: Record<string, string> = {
  voice: 'text-emerald-600 bg-emerald-50',
  whatsapp: 'text-green-600 bg-green-50',
  email: 'text-indigo-600 bg-indigo-50',
}

export function ActivityTable({ rows, total, page, pageSize, loading, onPageChange, onSearch, onSort, sortCol, sortDir }: Props) {
  const [searchInput, setSearchInput] = useState('')
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  function handleSearch() {
    onSearch(searchInput)
  }

  function toggleSort(col: string) {
    if (sortCol === col) {
      onSort(col, sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      onSort(col, 'desc')
    }
  }

  const columns = [
    { key: 'date', label: 'Date' },
    { key: 'contactName', label: 'Contact' },
    { key: 'channel', label: 'Channel' },
    { key: 'direction', label: 'Direction' },
    { key: 'sender', label: 'Sender' },
    { key: 'body', label: 'Preview' },
  ]

  return (
    <div className="rounded-xl border border-border bg-surface shadow-soft overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border p-3">
        <p className="text-[13px] font-semibold text-ink">Activity Log</p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <input
              type="text"
              placeholder="Search..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="rounded-lg border border-border bg-elevated pl-7 pr-3 py-1.5 text-[12px] text-ink placeholder:text-ink-subtle w-48 focus:outline-none focus:ring-1 focus:ring-brand/30"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-border bg-elevated/50">
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className="cursor-pointer px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted hover:text-ink transition select-none"
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    <ArrowUpDown size={10} className={cn(sortCol === col.key ? 'text-brand' : 'opacity-30')} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {columns.map(col => (
                    <td key={col.key} className="px-3 py-2.5">
                      <div className="h-3 w-20 skeleton" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-[12px] text-ink-muted">
                  No activity found
                </td>
              </tr>
            ) : (
              rows.map(row => {
                const Icon = channelIcon[row.channel] || MessageSquare
                const color = channelColor[row.channel] || 'text-gray-500 bg-gray-50'
                return (
                  <tr key={row.id} className="border-b border-border/50 hover:bg-elevated/30 transition">
                    <td className="px-3 py-2 text-[11px] text-ink-muted whitespace-nowrap">
                      {new Date(row.date).toLocaleString('en-GB', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-2 text-[12px] font-medium text-ink max-w-[140px] truncate">
                      {row.contactName}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
                        <Icon size={10} />
                        {row.channel}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        'inline-block rounded-full px-2 py-0.5 text-[10px] font-medium',
                        row.direction === 'inbound' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'
                      )}>
                        {row.direction}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-ink-muted capitalize">
                      {row.sender}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-ink-muted max-w-[200px] truncate">
                      {row.body || '-'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <p className="text-[11px] text-ink-muted">{total} total</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="rounded-md p-1 text-ink-muted hover:bg-elevated disabled:opacity-30 transition"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-[11px] text-ink-muted">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="rounded-md p-1 text-ink-muted hover:bg-elevated disabled:opacity-30 transition"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

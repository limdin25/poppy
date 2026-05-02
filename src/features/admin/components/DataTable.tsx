import { cn } from '@/core/lib/cn'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

interface Column<T> {
  key: string
  header: string
  render: (item: T) => ReactNode
  className?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor: (item: T) => string
  page?: number
  totalPages?: number
  onPageChange?: (page: number) => void
  onRowClick?: (item: T) => void
  emptyMessage?: string
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  page = 1,
  totalPages = 1,
  onPageChange,
  onRowClick,
  emptyMessage = 'No data found',
}: DataTableProps<T>) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border py-12">
        <p className="text-[13px] text-ink-muted">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border bg-elevated/50">
              {columns.map((col) => (
                <th key={col.key} className={cn('px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle', col.className)}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr
                key={keyExtractor(item)}
                onClick={() => onRowClick?.(item)}
                className={cn(
                  'border-b border-border last:border-b-0 transition',
                  onRowClick && 'cursor-pointer hover:bg-elevated/30'
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn('px-4 py-3 text-[13px] text-ink', col.className)}>
                    {col.render(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && onPageChange && (
        <div className="flex items-center justify-between border-t border-border bg-elevated/30 px-4 py-2.5">
          <p className="text-[12px] text-ink-muted">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="rounded-md p-1 text-ink-muted hover:bg-elevated disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="rounded-md p-1 text-ink-muted hover:bg-elevated disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

import type { ReactNode } from 'react'
import { cn } from '@/core/lib/cn'

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  className?: string
  align?: 'left' | 'right' | 'center'
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor: (row: T) => string
  onRowClick?: (row: T) => void
  selectable?: boolean
  selected?: Set<string>
  onToggle?: (id: string) => void
  onToggleAll?: () => void
  emptyMessage?: string
  className?: string
}

/** Waslo-style data table inside a rounded card. */
export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  selectable,
  selected,
  onToggle,
  onToggleAll,
  emptyMessage = 'Nothing here yet',
  className,
}: DataTableProps<T>) {
  const allSelected = selectable && data.length > 0 && selected && selected.size === data.length
  const alignCls = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left')

  return (
    <div className={cn('overflow-hidden rounded-2xl border border-border bg-surface shadow-soft', className)}>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr className="border-b border-border">
              {selectable && (
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={!!allSelected}
                    onChange={onToggleAll}
                    className="h-4 w-4 rounded border-border text-accent focus:ring-accent/20"
                  />
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    'px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle',
                    alignCls(c.align),
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-12 text-center text-[13px] text-ink-muted">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const id = keyExtractor(row)
                return (
                  <tr
                    key={id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn('border-b border-border last:border-0 transition-colors', onRowClick && 'cursor-pointer hover:bg-elevated/50')}
                  >
                    {selectable && (
                      <td className="w-10 px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected?.has(id) || false}
                          onChange={() => onToggle?.(id)}
                          className="h-4 w-4 rounded border-border text-accent focus:ring-accent/20"
                        />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={cn('px-4 py-3 text-[13px] text-ink', alignCls(c.align), c.className)}>
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

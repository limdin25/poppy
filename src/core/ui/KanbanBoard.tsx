import { useState, type ReactNode } from 'react'
import { cn } from '@/core/lib/cn'

export interface KanbanColumn<T> {
  id: string
  title: string
  accent?: string // tailwind text/bg class for the dot
  items: T[]
}

interface KanbanBoardProps<T> {
  columns: KanbanColumn<T>[]
  keyExtractor: (item: T) => string
  renderCard: (item: T) => ReactNode
  /** Enables drag-and-drop. Called with the dragged item id and the column it was dropped on. */
  onMove?: (itemId: string, toColumnId: string) => void
  className?: string
}

/** Waslo-style kanban: horizontal columns with a count + stacked cards. Drag to move when onMove is set. */
export function KanbanBoard<T>({ columns, keyExtractor, renderCard, onMove, className }: KanbanBoardProps<T>) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const draggable = !!onMove

  function handleDrop(colId: string) {
    if (dragId && onMove) onMove(dragId, colId)
    setDragId(null)
    setOverCol(null)
  }

  return (
    <div className={cn('flex gap-4 overflow-x-auto pb-2 scrollbar-thin', className)}>
      {columns.map((col) => (
        <div key={col.id} className="flex w-[300px] shrink-0 flex-col">
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className={cn('h-2 w-2 rounded-full', col.accent || 'bg-ink-subtle')} />
            <span className="text-[12px] font-semibold uppercase tracking-wide text-ink">{col.title}</span>
            <span className="ml-auto rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium text-ink-muted">
              {col.items.length}
            </span>
          </div>
          <div
            onDragOver={draggable ? (e) => { e.preventDefault(); setOverCol(col.id) } : undefined}
            onDragLeave={draggable ? () => setOverCol((c) => (c === col.id ? null : c)) : undefined}
            onDrop={draggable ? (e) => { e.preventDefault(); handleDrop(col.id) } : undefined}
            className={cn(
              'flex flex-1 flex-col gap-2 rounded-2xl border p-2 transition-colors',
              overCol === col.id ? 'border-accent/40 bg-accent/[0.03]' : 'border-border bg-page',
            )}
          >
            {col.items.length === 0 ? (
              <p className="px-2 py-6 text-center text-[12px] text-ink-subtle">
                {draggable ? 'Drop a lead here' : 'No leads'}
              </p>
            ) : (
              col.items.map((item) => {
                const id = keyExtractor(item)
                return (
                  <div
                    key={id}
                    draggable={draggable}
                    onDragStart={draggable ? () => setDragId(id) : undefined}
                    onDragEnd={draggable ? () => { setDragId(null); setOverCol(null) } : undefined}
                    className={cn(
                      'rounded-xl border border-border bg-surface p-3 shadow-soft transition',
                      draggable && 'cursor-grab active:cursor-grabbing hover:border-ink-subtle/40',
                      dragId === id && 'opacity-50',
                    )}
                  >
                    {renderCard(item)}
                  </div>
                )
              })
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

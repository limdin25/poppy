import { TriangleAlert } from 'lucide-react'

export function AdminError({ error }: { error: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-[13px] text-danger">
      <TriangleAlert size={15} className="mt-0.5 shrink-0" />
      <span>{error}</span>
    </div>
  )
}

import { ExternalLink } from 'lucide-react'

/**
 * Hugo's deal pipeline (the Leads CRM board) surfaced inside the admin panel.
 * Same-origin embed of the real /leads page, so drag-and-drop, stage editing
 * and click-to-call all work exactly as in the main app — qualified BRRR
 * properties land here in the "Qualified" stage.
 */
export default function PipelinePage() {
  return (
    <div className="flex h-full min-h-[80vh] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Pipeline</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            Your CRM board — qualified properties arrive in the "Qualified" stage; drag cards between stages, click the phone icon to call
          </p>
        </div>
        <a
          href="/leads"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-ink-muted transition hover:bg-elevated"
        >
          Open full page <ExternalLink size={13} />
        </a>
      </div>

      <div className="mt-4 flex-1 overflow-hidden rounded-xl border border-border bg-surface">
        <iframe src="/leads" title="Deal pipeline" className="h-full min-h-[75vh] w-full" />
      </div>
    </div>
  )
}

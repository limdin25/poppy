export default function AdminLoading() {
  return (
    <div className="animate-pulse space-y-6 p-4 sm:p-6">
      <div className="space-y-2">
        <div className="h-7 w-48 rounded-lg bg-background-secondary" />
        <div className="h-4 w-64 rounded-lg bg-background-secondary" />
      </div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border p-4 space-y-3">
            <div className="h-3 w-16 rounded bg-background-secondary" />
            <div className="h-7 w-24 rounded bg-background-secondary" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-border p-5 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-background-secondary" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-32 rounded bg-background-secondary" />
              <div className="h-3 w-48 rounded bg-background-secondary" />
            </div>
            <div className="h-6 w-16 rounded-full bg-background-secondary" />
          </div>
        ))}
      </div>
    </div>
  );
}

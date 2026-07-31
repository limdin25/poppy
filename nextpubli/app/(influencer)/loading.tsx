export default function InfluencerLoading() {
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
            <div className="h-3 w-20 rounded bg-background-secondary" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border p-5 space-y-4">
            <div className="h-4 w-32 rounded bg-background-secondary" />
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, j) => (
                <div
                  key={j}
                  className="h-5 w-full rounded-full bg-background-secondary"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

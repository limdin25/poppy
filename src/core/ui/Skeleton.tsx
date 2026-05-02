import { cn } from "@/core/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4 w-full", className)} />;
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="skeleton h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="w-1/3" />
        <Skeleton className="w-1/2 h-3" />
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className ?? ''}`} />
}

export function MeetingsGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-4 flex flex-col min-h-[180px]">
          <div className="flex-1">
            <div className="flex items-start justify-between gap-2 mb-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full mb-3" />
            <Skeleton className="h-3 w-full mb-1.5" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <div className="pt-2 border-t border-border/50 mt-auto">
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function DashboardStatsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-5">
          <div className="flex items-center gap-3 mb-2">
            <Skeleton className="w-9 h-9 rounded-md" />
            <Skeleton className="h-3.5 w-16" />
          </div>
          <Skeleton className="h-8 w-12" />
        </div>
      ))}
    </div>
  )
}

export function DashboardMeetingsSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-3 w-2/3 mt-2" />
        </div>
      ))}
    </div>
  )
}

export function MeetingPageSkeleton() {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-6 py-4 bg-white border-b shrink-0">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </div>
      <div className="flex-1 flex min-h-0 p-6 gap-6">
        <div className="flex-1 space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="w-80 space-y-3">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  )
}

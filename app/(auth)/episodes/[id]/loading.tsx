export default function EpisodeDetailLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 bg-[#2e2e2e] rounded-lg" />
        <div className="h-5 w-32 bg-[#2e2e2e] rounded" />
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-4 w-28 bg-[#2e2e2e] rounded" />
          <div className="h-9 w-64 bg-[#2e2e2e] rounded-lg" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 bg-[#2e2e2e] rounded-lg" />
          <div className="h-9 w-24 bg-[#2e2e2e] rounded-lg" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl p-4 bg-[#1e1e1e] border border-[#2e2e2e] space-y-3">
            <div className="h-4 w-24 bg-[#2e2e2e] rounded" />
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="flex items-center gap-3 py-2.5 border-b border-[#2e2e2e]">
                <div className="w-6 h-6 rounded-full bg-[#2e2e2e] shrink-0" />
                <div className="flex-1 space-y-1">
                  <div className="h-4 w-3/4 bg-[#2e2e2e] rounded" />
                  <div className="h-3 w-1/2 bg-[#2e2e2e] rounded" />
                </div>
                <div className="h-6 w-16 bg-[#2e2e2e] rounded-full" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

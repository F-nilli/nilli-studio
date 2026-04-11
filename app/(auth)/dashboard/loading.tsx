export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-[#2e2e2e] rounded-lg" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl p-5 bg-[#1e1e1e] border border-[#2e2e2e] space-y-4">
            <div className="h-5 w-32 bg-[#2e2e2e] rounded" />
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className="flex items-center gap-3 py-3 border-b border-[#2e2e2e]">
                <div className="w-8 h-8 rounded-full bg-[#2e2e2e] shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-3/4 bg-[#2e2e2e] rounded" />
                  <div className="h-3 w-1/2 bg-[#2e2e2e] rounded" />
                </div>
                <div className="h-6 w-20 bg-[#2e2e2e] rounded-full" />
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="rounded-xl p-5 bg-[#1e1e1e] border border-[#2e2e2e] space-y-4">
        <div className="h-5 w-40 bg-[#2e2e2e] rounded" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-3 border-b border-[#2e2e2e]">
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-2/3 bg-[#2e2e2e] rounded" />
              <div className="h-3 w-1/3 bg-[#2e2e2e] rounded" />
            </div>
            <div className="h-2.5 w-32 bg-[#2e2e2e] rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

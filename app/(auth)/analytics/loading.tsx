export default function AnalyticsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-36 bg-[#2e2e2e] rounded-lg" />
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 w-20 bg-[#2e2e2e] rounded-lg" />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl p-5 bg-[#1e1e1e] border border-[#2e2e2e] space-y-2">
            <div className="h-3 w-24 bg-[#2e2e2e] rounded" />
            <div className="h-9 w-16 bg-[#2e2e2e] rounded" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl p-5 bg-[#1e1e1e] border border-[#2e2e2e] space-y-4">
            <div className="h-5 w-40 bg-[#2e2e2e] rounded" />
            <div className="h-48 w-full bg-[#2e2e2e] rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  )
}

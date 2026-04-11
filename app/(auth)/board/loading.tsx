export default function BoardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-[#2e2e2e] rounded-lg" />
          <div className="h-4 w-24 bg-[#2e2e2e] rounded" />
        </div>
        <div className="h-10 w-36 bg-[#2e2e2e] rounded-lg" />
      </div>

      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl p-4 bg-[#1e1e1e] border border-[#2e2e2e]">
            <div className="h-8 w-12 bg-[#2e2e2e] rounded mb-2" />
            <div className="h-3 w-20 bg-[#2e2e2e] rounded" />
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-8 w-20 bg-[#2e2e2e] rounded-lg" />
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-2xl p-5 bg-[#1e1e1e] border border-[#2e2e2e] space-y-4">
            <div className="flex items-start justify-between">
              <div className="space-y-2 flex-1">
                <div className="h-3 w-24 bg-[#2e2e2e] rounded" />
                <div className="h-6 w-40 bg-[#2e2e2e] rounded" />
              </div>
              <div className="h-7 w-16 bg-[#2e2e2e] rounded-lg" />
            </div>
            <div className="space-y-2">
              <div className="h-2.5 w-full bg-[#2e2e2e] rounded-full" />
            </div>
            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-[#2e2e2e]">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="text-center space-y-1">
                  <div className="h-6 w-8 bg-[#2e2e2e] rounded mx-auto" />
                  <div className="h-3 w-12 bg-[#2e2e2e] rounded mx-auto" />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-1">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="w-8 h-8 rounded-full bg-[#2e2e2e]" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

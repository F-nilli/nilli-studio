export default function CalendarLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 bg-[#2e2e2e] rounded-lg" />
          <div className="h-7 w-40 bg-[#2e2e2e] rounded-lg" />
          <div className="h-8 w-8 bg-[#2e2e2e] rounded-lg" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-20 bg-[#2e2e2e] rounded-lg" />
          <div className="h-8 w-20 bg-[#2e2e2e] rounded-lg" />
        </div>
      </div>

      <div className="rounded-xl overflow-hidden border border-[#2e2e2e] bg-[#1e1e1e]">
        <div className="grid grid-cols-7 border-b border-[#2e2e2e]">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="py-3 px-2 text-center">
              <div className="h-3 w-8 bg-[#2e2e2e] rounded mx-auto" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="min-h-[100px] p-2 border-b border-r border-[#2e2e2e] space-y-1.5">
              <div className="h-5 w-5 bg-[#2e2e2e] rounded-full" />
              {i % 4 === 0 && <div className="h-5 w-full bg-[#2e2e2e] rounded" />}
              {i % 7 === 2 && <div className="h-5 w-3/4 bg-[#2e2e2e] rounded" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function ProfileLoading() {
  return (
    <div className="max-w-lg animate-pulse">
      <div className="h-9 w-28 bg-[#2e2e2e] rounded-lg mb-6" />

      <div className="bg-[#141414] rounded-xl border border-[#2e2e2e] p-6 space-y-6">
        {/* Avatar + name header */}
        <div className="flex items-center gap-4 pb-4 border-b border-[#2e2e2e]">
          <div className="w-16 h-16 rounded-full bg-[#2e2e2e] shrink-0" />
          <div className="space-y-2">
            <div className="h-5 w-28 bg-[#2e2e2e] rounded" />
            <div className="h-4 w-40 bg-[#2e2e2e] rounded" />
            <div className="h-5 w-16 bg-[#2e2e2e] rounded-full" />
          </div>
        </div>

        {/* Color swatches */}
        <div className="space-y-2">
          <div className="h-4 w-32 bg-[#2e2e2e] rounded" />
          <div className="flex gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="w-8 h-8 rounded-full bg-[#2e2e2e]" />
            ))}
          </div>
        </div>

        {/* Input field */}
        <div className="space-y-1.5">
          <div className="h-4 w-20 bg-[#2e2e2e] rounded" />
          <div className="h-10 w-full bg-[#1e1e1e] rounded-lg border border-[#2e2e2e]" />
        </div>

        {/* Save button */}
        <div className="h-10 w-full bg-[#2e2e2e] rounded-lg" />
      </div>
    </div>
  )
}

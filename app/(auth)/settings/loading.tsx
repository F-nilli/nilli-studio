export default function SettingsLoading() {
  return (
    <div className="animate-pulse">
      {/* Title */}
      <div className="h-9 w-32 bg-[#2e2e2e] rounded-lg mb-8" />

      <div className="flex gap-8 items-start">
        {/* Left tab column */}
        <div className="w-48 shrink-0 space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 rounded-lg bg-[#1e1e1e]" style={{ opacity: 1 - i * 0.1 }} />
          ))}
        </div>

        {/* Right content panel */}
        <div className="flex-1 bg-[#141414] rounded-xl border border-[#2e2e2e] p-6 space-y-6">
          {/* Section header */}
          <div className="h-6 w-48 bg-[#2e2e2e] rounded" />

          {/* Row items */}
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-4 border-b border-[#1e1e1e]">
              <div className="w-10 h-10 rounded-full bg-[#2e2e2e] shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-36 bg-[#2e2e2e] rounded" />
                <div className="h-3 w-24 bg-[#2e2e2e] rounded" />
              </div>
              <div className="h-8 w-20 bg-[#2e2e2e] rounded-lg" />
            </div>
          ))}

          {/* Form fields */}
          <div className="space-y-4 pt-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3.5 w-24 bg-[#2e2e2e] rounded" />
                <div className="h-10 w-full bg-[#1e1e1e] rounded-lg border border-[#2e2e2e]" />
              </div>
            ))}
          </div>

          {/* Save button */}
          <div className="h-10 w-32 bg-[#2e2e2e] rounded-lg" />
        </div>
      </div>
    </div>
  )
}

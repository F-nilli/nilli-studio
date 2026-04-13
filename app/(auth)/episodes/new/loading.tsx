export default function NewEpisodeLoading() {
  return (
    <div className="max-w-2xl animate-pulse">
      {/* Back + title */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 rounded-md bg-[#2e2e2e]" />
        <div className="h-9 w-36 bg-[#2e2e2e] rounded-lg" />
      </div>

      <div className="bg-[#141414] rounded-xl border border-[#2e2e2e] p-6 space-y-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-4 w-24 bg-[#2e2e2e] rounded" />
            <div className="h-10 w-full bg-[#1e1e1e] rounded-lg border border-[#2e2e2e]" />
          </div>
        ))}

        {/* Action buttons */}
        <div className="flex gap-3 pt-2">
          <div className="flex-1 h-11 bg-[#1e1e1e] rounded-lg border border-[#2e2e2e]" />
          <div className="flex-1 h-11 bg-[#2e2e2e] rounded-lg" />
        </div>
      </div>
    </div>
  )
}

import { cn } from '@/lib/utils'
import { TaskStatus } from '@/lib/types'

const STATUS_STYLES: Record<string, string> = {
  locked:     'bg-gradient-to-r from-white/5 to-white/[0.03] text-[#555] border border-white/[0.06]',
  in_progress:'bg-gradient-to-r from-amber-500/25 to-amber-500/10 text-amber-300 border border-amber-500/20',
  in_review:  'bg-gradient-to-r from-purple-500/25 to-purple-500/10 text-purple-300 border border-purple-500/20',
  approved:   'bg-gradient-to-r from-green-500/25 to-green-500/10 text-green-300 border border-green-500/20',
  revision:   'bg-gradient-to-r from-[#ff3c00]/25 to-[#ff3c00]/10 text-[#ff7a5c] border border-[#ff3c00]/20',
  done:       'bg-gradient-to-r from-green-500/20 to-green-500/8 text-green-400 border border-green-500/15',
}

const STATUS_LABELS: Record<string, string> = {
  locked: 'Locked', in_progress: 'In Progress',
  in_review: 'In Review', approved: 'Approved', revision: 'Revision', done: 'Done',
}

interface StatusBadgeProps {
  status: TaskStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-semibold', STATUS_STYLES[status] || 'bg-[#1e1e1e] text-[#555]', className)}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

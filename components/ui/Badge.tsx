import { cn } from '@/lib/utils'
import { TaskStatus } from '@/lib/types'

const STATUS_STYLES: Record<string, string> = {
  locked:     'bg-[#1e1e1e] text-[#666]',
  ready:      'bg-blue-500/20 text-blue-400',
  in_progress:'bg-yellow-500/20 text-yellow-400',
  in_review:  'bg-purple-500/20 text-purple-400',
  approved:   'bg-green-500/20 text-green-400',
  revision:   'bg-[#ff3c00]/20 text-[#ff6633]',
  done:       'bg-green-500/20 text-green-300',
}

const STATUS_LABELS: Record<string, string> = {
  locked: 'Locked', ready: 'Ready', in_progress: 'In Progress',
  in_review: 'In Review', approved: 'Approved', revision: 'Revision', done: 'Done',
}

interface StatusBadgeProps {
  status: TaskStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', STATUS_STYLES[status] || 'bg-[#1e1e1e] text-[#666]', className)}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

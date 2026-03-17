import { cn, getStatusBg, STATUS_LABELS } from '@/lib/utils'
import { TaskStatus } from '@/lib/types'

interface StatusBadgeProps {
  status: TaskStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        getStatusBg(status),
        className
      )}
    >
      {STATUS_LABELS[status] || status}
    </span>
  )
}

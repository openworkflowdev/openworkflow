import { CheckCircle, Circle, Clock, XCircle } from '@phosphor-icons/react'

import type { WorkflowStatus } from '@/types'

import { Badge } from './ui/badge'

interface StatusBadgeProps {
  status: WorkflowStatus
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = {
    completed: {
      label: 'Completed',
      icon: CheckCircle,
      className: 'bg-green-500/10 text-green-500 border-green-500/20',
    },
    running: {
      label: 'Running',
      icon: Circle,
      className: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    },
    failed: {
      label: 'Failed',
      icon: XCircle,
      className: 'bg-red-500/10 text-red-500 border-red-500/20',
    },
    pending: {
      label: 'Pending',
      icon: Clock,
      className: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    },
  }

  const { label, icon: Icon, className } = config[status]

  return (
    <Badge variant="outline" className={className}>
      <Icon className="mr-1 h-3 w-3" weight="fill" />
      {label}
    </Badge>
  )
}

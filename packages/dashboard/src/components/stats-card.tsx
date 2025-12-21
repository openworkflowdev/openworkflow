import {
  CheckCircleIcon,
  CircleIcon,
  PulseIcon,
  XCircleIcon,
} from '@phosphor-icons/react'

import { Card } from './ui/card'

interface StatsCardProps {
  title: string
  value: number
  trend: string
  type: 'total' | 'completed' | 'running' | 'failed'
}

export function StatsCard({ title, value, trend, type }: StatsCardProps) {
  const icons = {
    total: PulseIcon,
    completed: CheckCircleIcon,
    running: CircleIcon,
    failed: XCircleIcon,
  }

  const Icon = icons[type]
  const isPositive = trend.startsWith('+')
  const isNegative = trend.startsWith('-')

  return (
    <Card className="p-6 bg-card border-border">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">{title}</span>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="text-3xl font-bold mb-2">{value.toLocaleString()}</div>
      <div className="flex items-center text-sm">
        <span
          className={
            isPositive && type !== 'failed'
              ? 'text-green-500'
              : isNegative && type === 'failed'
                ? 'text-green-500'
                : 'text-muted-foreground'
          }
        >
          {trend}
        </span>
        <span className="text-muted-foreground ml-2">vs last 24h</span>
      </div>
    </Card>
  )
}

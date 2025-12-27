import { CaretRightIcon, ClockIcon } from '@phosphor-icons/react'
import { Link } from '@tanstack/react-router'

import type { Workflow } from '@/types'

import { Badge } from './ui/badge'
import { Card } from './ui/card'

interface WorkflowCardProps {
  workflow: Workflow
  stats: {
    completed: number
    running: number
    failed: number
  }
}

export function WorkflowCard({ workflow, stats }: WorkflowCardProps) {
  return (
    <Link to="/workflows/$workflowId" params={{ workflowId: workflow.id }}>
      <Card className="p-6 bg-card border-border hover:border-primary/50 transition-colors cursor-pointer group">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-lg font-semibold">{workflow.name}</h3>
              <Badge variant="outline" className="text-xs">
                {workflow.version}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {workflow.description}
            </p>
          </div>
          <CaretRightIcon className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>

        <div className="flex items-center gap-4 text-sm mt-4">
          <span className="text-muted-foreground">
            {workflow.totalRuns} total runs
          </span>
          <span className="text-green-500">{stats.completed} completed</span>
          <span className="text-blue-500">{stats.running} running</span>
          <span className="text-red-500">{stats.failed} failed</span>
        </div>

        {workflow.lastRun && (
          <div className="flex items-center gap-2 mt-4 text-sm text-muted-foreground">
            <ClockIcon className="h-4 w-4" />
            <span>Last run {workflow.lastRun}</span>
          </div>
        )}
      </Card>
    </Link>
  )
}

import {
  ArrowLeft,
  CaretLeft,
  CaretRight,
  CheckCircle,
  CircleNotch,
  Clock,
  XCircle,
} from '@phosphor-icons/react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import { AppLayout } from '@/components/app-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getRunsByWorkflowId, getWorkflowById } from '@/mocks/mock-data'
import type { WorkflowStatus } from '@/types'

export const Route = createFileRoute('/workflows/$workflowId/')({
  component: WorkflowRunsPage,
})

type FilterTab = 'all' | WorkflowStatus

const statusConfig: Record<
  WorkflowStatus,
  { icon: typeof CheckCircle; color: string; label: string }
> = {
  completed: { icon: CheckCircle, color: 'text-green-500', label: 'Completed' },
  running: { icon: CircleNotch, color: 'text-blue-500', label: 'Running' },
  failed: { icon: XCircle, color: 'text-red-500', label: 'Failed' },
  pending: { icon: Clock, color: 'text-yellow-500', label: 'Pending' },
}

function WorkflowRunsPage() {
  const { workflowId } = Route.useParams()
  const workflow = getWorkflowById(workflowId)
  const [currentPage, setCurrentPage] = useState(1)
  const [filter, setFilter] = useState<FilterTab>('all')
  const pageSize = 10

  if (!workflow) {
    return (
      <AppLayout>
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold mb-2">Workflow Not Found</h2>
          <p className="text-muted-foreground">
            The workflow you're looking for doesn't exist.
          </p>
        </div>
      </AppLayout>
    )
  }

  const allRuns = getRunsByWorkflowId(workflowId)
  const filteredRuns =
    filter === 'all' ? allRuns : allRuns.filter((r) => r.status === filter)
  const totalPages = Math.ceil(filteredRuns.length / pageSize)
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = startIndex + pageSize
  const currentRuns = filteredRuns.slice(startIndex, endIndex)

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="size-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-2xl font-semibold">{workflow.name}</h2>
              <Badge variant="outline" className="font-mono border-border">
                {workflow.version}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {workflow.description}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {(['all', 'running', 'completed', 'failed'] as const).map(
              (status) => (
                <Button
                  key={status}
                  variant={filter === status ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    setFilter(status)
                    setCurrentPage(1)
                  }}
                  className="capitalize"
                >
                  {status}
                </Button>
              ),
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            Showing {startIndex + 1}-{Math.min(endIndex, filteredRuns.length)}{' '}
            of {filteredRuns.length} runs
          </div>
        </div>

        <Card className="bg-card border-border overflow-hidden py-0">
          <div className="divide-y divide-border">
            {currentRuns.map((run) => {
              const config = statusConfig[run.status]
              const StatusIcon = config.icon

              return (
                <Link
                  key={run.id}
                  to="/workflows/$workflowId/runs/$runId"
                  params={{ workflowId, runId: run.id }}
                  className="block px-6 py-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1">
                      <StatusIcon
                        className={`size-5 ${config.color} ${run.status === 'running' ? 'animate-spin' : ''}`}
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-mono text-sm">{run.id}</span>
                          <Badge
                            variant="outline"
                            className={`text-xs capitalize border-border ${
                              run.status === 'completed'
                                ? 'bg-green-500/10 text-green-500 border-green-500/20'
                                : run.status === 'running'
                                  ? 'bg-blue-500/10 text-blue-500 border-blue-500/20'
                                  : run.status === 'failed'
                                    ? 'bg-red-500/10 text-red-500 border-red-500/20'
                                    : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                            }`}
                          >
                            {config.label}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="text-xs capitalize border-border"
                          >
                            {run.triggeredBy}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex items-center gap-8 text-sm">
                        <div className="text-right">
                          <p className="text-muted-foreground">Steps</p>
                          <p className="font-mono">
                            {run.steps.completed}/{run.steps.total}
                          </p>
                        </div>

                        {run.duration && (
                          <div className="text-right">
                            <p className="text-muted-foreground">Duration</p>
                            <p className="font-mono">{run.duration}</p>
                          </div>
                        )}

                        <div className="text-right min-w-24">
                          <p className="text-muted-foreground">Started</p>
                          <p>{run.startedAt}</p>
                        </div>
                      </div>
                    </div>

                    <CaretRight className="size-5 text-muted-foreground ml-4" />
                  </div>
                </Link>
              )
            })}
          </div>
        </Card>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <CaretLeft className="size-4" />
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number
                if (totalPages <= 5) {
                  pageNum = i + 1
                } else if (currentPage <= 3) {
                  pageNum = i + 1
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i
                } else {
                  pageNum = currentPage - 2 + i
                }

                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setCurrentPage(pageNum)}
                    className="w-10"
                  >
                    {pageNum}
                  </Button>
                )
              })}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <CaretRight className="size-4" />
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

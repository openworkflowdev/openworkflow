import { CaretRight, Clock, MagnifyingGlass } from '@phosphor-icons/react'
import { Link } from '@tanstack/react-router'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { workflows } from '@/mocks/mock-data'

export function WorkflowList() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Workflows</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Browse and monitor your workflow definitions
          </p>
        </div>
        <div className="relative">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search workflows..."
            className="pl-10 w-64 bg-card border-border"
          />
        </div>
      </div>

      <Card className="bg-card border-border overflow-hidden py-0">
        <div className="divide-y divide-border">
          {workflows.map((workflow) => (
            <Link
              key={workflow.id}
              to="/workflows/$workflowId"
              params={{ workflowId: workflow.id }}
              className="block px-6 py-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 flex-1">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-medium text-lg">
                        {workflow.name}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-xs font-mono border-border"
                      >
                        {workflow.version}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      {workflow.description}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="font-mono">
                        {workflow.totalRuns} total runs
                      </span>
                      <span className="text-green-500">
                        {workflow.recentRuns.completed} completed
                      </span>
                      <span className="text-blue-500">
                        {workflow.recentRuns.running} running
                      </span>
                      <span className="text-red-500">
                        {workflow.recentRuns.failed} failed
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-8">
                    {workflow.lastRun && (
                      <div className="text-right flex items-center gap-2">
                        <Clock className="size-4 text-muted-foreground" />
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Last run
                          </p>
                          <p className="text-sm">{workflow.lastRun}</p>
                        </div>
                      </div>
                    )}
                    <CaretRight className="size-5 text-muted-foreground" />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  )
}

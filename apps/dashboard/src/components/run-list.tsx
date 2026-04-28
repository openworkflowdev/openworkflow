import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getRunStatusConfig } from "@/lib/status";
import { cn } from "@/lib/utils";
import { computeDuration, formatRelativeTime } from "@/utils";
import { CaretRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { WorkflowRun } from "openworkflow/internal";

export interface ChildRunRelation {
  parentRunId: string;
  parentWorkflowName?: string | undefined;
}

export interface RunListProps {
  runs: WorkflowRun[];
  childRunRelationsByRunId?: Record<string, ChildRunRelation | undefined>;
  title?: string;
  showHeader?: boolean;
  showCount?: boolean;
}

export function RunList({
  runs,
  childRunRelationsByRunId,
  title = "Workflow Runs",
  showHeader = true,
  showCount = true,
}: RunListProps) {
  if (runs.length === 0) {
    return (
      <div className="space-y-4">
        {showHeader && (
          <div>
            <h2 className="text-2xl font-semibold">{title}</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              No workflow runs found
            </p>
          </div>
        )}
        <Card className="bg-card border-border p-8 text-center">
          <p className="text-muted-foreground">
            No workflow runs have been created yet.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showHeader && (
        <div>
          <h2 className="text-2xl font-semibold">{title}</h2>
          {showCount && (
            <p className="text-muted-foreground mt-1 text-sm">
              {runs.length} workflow run{runs.length === 1 ? "" : "s"}
            </p>
          )}
        </div>
      )}

      <Card className="bg-card border-border overflow-hidden py-0">
        <div className="divide-border divide-y">
          {runs.map((run) => {
            const config = getRunStatusConfig(run.status);
            const StatusIcon = config.icon;
            const duration = computeDuration(run.startedAt, run.finishedAt);
            const startedAt = formatRelativeTime(run.startedAt);
            const childRunRelation = childRunRelationsByRunId?.[run.id];

            return (
              <Link
                key={run.id}
                to="/runs/$runId"
                params={{ runId: run.id }}
                className="hover:bg-muted/50 block px-4 py-4 transition-colors sm:px-6"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center sm:gap-4">
                    <StatusIcon
                      className={cn(
                        "mt-0.5 size-5 shrink-0 sm:mt-0",
                        config.color,
                        run.status === "running" && "animate-spin",
                      )}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2 sm:gap-3">
                        <span className="font-medium wrap-break-word">
                          {run.workflowName}
                        </span>
                        {run.version && (
                          <Badge variant="outline">{run.version}</Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground mb-2 font-mono text-xs break-all">
                        {run.id}
                      </p>
                      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                        <Badge
                          variant="outline"
                          className={cn("capitalize", config.badgeClass)}
                        >
                          {config.label}
                        </Badge>
                        {childRunRelation && (
                          <Badge
                            variant="outline"
                            className="h-auto max-w-full min-w-0 py-1 break-all whitespace-normal"
                          >
                            {childRunRelation.parentWorkflowName && (
                              <span className="mr-2 font-medium wrap-break-word">
                                [{childRunRelation.parentWorkflowName}]
                              </span>
                            )}
                            <span className="break-all">
                              {childRunRelation.parentRunId}
                            </span>
                          </Badge>
                        )}
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:hidden">
                        <div>
                          <p className="text-muted-foreground">Duration</p>
                          <p className="font-mono">{duration}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-muted-foreground">Started</p>
                          <p>{startedAt}</p>
                        </div>
                      </div>
                    </div>

                    <div className="hidden items-center gap-8 text-sm sm:flex">
                      <div className="text-right">
                        <p className="text-muted-foreground">Duration</p>
                        <p className="font-mono">{duration}</p>
                      </div>

                      <div className="min-w-24 text-right">
                        <p className="text-muted-foreground">Started</p>
                        <p>{startedAt}</p>
                      </div>
                    </div>
                  </div>

                  <CaretRightIcon className="text-muted-foreground mt-0.5 size-5 shrink-0 sm:mt-0 sm:ml-4" />
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

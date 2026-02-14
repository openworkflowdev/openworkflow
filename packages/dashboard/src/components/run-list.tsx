import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { STATUS_CONFIG } from "@/lib/status";
import { cn } from "@/lib/utils";
import { computeDuration, formatRelativeTime } from "@/utils";
import { CaretRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { WorkflowRun } from "openworkflow/internal";

export interface RunListProps {
  runs: WorkflowRun[];
  title?: string;
}

export function RunList({ runs, title = "Workflow Runs" }: RunListProps) {
  if (runs.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold">{title}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            No workflow runs found
          </p>
        </div>
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
      <div>
        <h2 className="text-2xl font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {runs.length} workflow run{runs.length === 1 ? "" : "s"}
        </p>
      </div>

      <Card className="bg-card border-border overflow-hidden py-0">
        <div className="divide-border divide-y">
          {runs.map((run) => {
            const config = STATUS_CONFIG[run.status];
            const StatusIcon = config.icon;
            const duration = computeDuration(run.startedAt, run.finishedAt);
            const startedAt = formatRelativeTime(run.startedAt);

            return (
              <Link
                key={run.id}
                to="/runs/$runId"
                params={{ runId: run.id }}
                className="hover:bg-muted/50 block px-6 py-4 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex flex-1 items-center gap-4">
                    <StatusIcon
                      className={cn(
                        "size-5",
                        config.color,
                        run.status === "running" && "animate-spin",
                      )}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-3">
                        <span className="font-medium">{run.workflowName}</span>
                        {run.version && (
                          <Badge
                            variant="outline"
                            className="border-border font-mono text-xs"
                          >
                            {run.version}
                          </Badge>
                        )}
                        <span className="text-muted-foreground font-mono text-sm">
                          {run.id}
                        </span>
                      </div>
                      <div className="text-muted-foreground flex items-center gap-4 text-xs">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs capitalize",
                            config.badgeClass,
                          )}
                        >
                          {config.label}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex items-center gap-8 text-sm">
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

                  <CaretRightIcon className="text-muted-foreground ml-4 size-5" />
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

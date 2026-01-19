import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { SerializedWorkflowRun, WorkflowRunStatus } from "@/types";
import { computeDuration, formatRelativeTime } from "@/types";
import {
  CaretRight,
  CheckCircle,
  CircleNotch,
  Clock,
  Hourglass,
  Prohibit,
  XCircle,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

export interface RunListProps {
  runs: SerializedWorkflowRun[];
  title?: string;
}

const statusConfig: Record<
  WorkflowRunStatus,
  { icon: typeof CheckCircle; color: string; label: string }
> = {
  completed: { icon: CheckCircle, color: "text-green-500", label: "Completed" },
  succeeded: { icon: CheckCircle, color: "text-green-500", label: "Completed" },
  running: { icon: CircleNotch, color: "text-blue-500", label: "Running" },
  failed: { icon: XCircle, color: "text-red-500", label: "Failed" },
  pending: { icon: Clock, color: "text-yellow-500", label: "Pending" },
  sleeping: { icon: Hourglass, color: "text-purple-500", label: "Sleeping" },
  canceled: { icon: Prohibit, color: "text-gray-500", label: "Canceled" },
};

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
            const config = statusConfig[run.status];
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
                      className={`size-5 ${config.color} ${run.status === "running" ? "animate-spin" : ""}`}
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
                          className={`border-border text-xs capitalize ${
                            run.status === "completed" ||
                            run.status === "succeeded"
                              ? "border-green-500/20 bg-green-500/10 text-green-500"
                              : run.status === "running"
                                ? "border-blue-500/20 bg-blue-500/10 text-blue-500"
                                : run.status === "failed"
                                  ? "border-red-500/20 bg-red-500/10 text-red-500"
                                  : run.status === "sleeping"
                                    ? "border-purple-500/20 bg-purple-500/10 text-purple-500"
                                    : run.status === "canceled"
                                      ? "border-gray-500/20 bg-gray-500/10 text-gray-500"
                                      : "border-yellow-500/20 bg-yellow-500/10 text-yellow-500"
                          }`}
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

                  <CaretRight className="text-muted-foreground ml-4 size-5" />
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

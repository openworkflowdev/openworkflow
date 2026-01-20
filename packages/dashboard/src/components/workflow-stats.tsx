import { Card } from "@/components/ui/card";
import {
  CheckCircle,
  Clock,
  Hourglass,
  Pulse,
  XCircle,
} from "@phosphor-icons/react";
import type { WorkflowRun } from "openworkflow/internal";

export interface WorkflowStatsProps {
  runs: WorkflowRun[];
}

export function WorkflowStats({ runs }: WorkflowStatsProps) {
  // this computes stats from real run data as a placeholder until the backend
  // is updated to provide aggregated stats
  const completed = runs.filter(
    (r) => r.status === "completed" || r.status === "succeeded",
  ).length;
  const running = runs.filter((r) => r.status === "running").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const pending = runs.filter((r) => r.status === "pending").length;
  const sleeping = runs.filter((r) => r.status === "sleeping").length;
  const canceled = runs.filter((r) => r.status === "canceled").length;

  const stats = [
    {
      label: "Total Runs",
      value: runs.length.toLocaleString(),
      icon: Pulse,
    },
    {
      label: "Completed",
      value: completed.toLocaleString(),
      icon: CheckCircle,
    },
    {
      label: "Running",
      value: running.toLocaleString(),
      icon: Clock,
    },
    {
      label: "Failed",
      value: failed.toLocaleString(),
      icon: XCircle,
    },
  ];

  const additionalStats = [];
  if (sleeping > 0) {
    additionalStats.push({
      label: "Sleeping",
      value: sleeping.toLocaleString(),
      icon: Hourglass,
    });
  }
  if (pending > 0) {
    additionalStats.push({
      label: "Pending",
      value: pending.toLocaleString(),
      icon: Clock,
    });
  }
  if (canceled > 0) {
    additionalStats.push({
      label: "Canceled",
      value: canceled.toLocaleString(),
      icon: XCircle,
    });
  }

  const allStats = [...stats, ...additionalStats];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {allStats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card
            key={stat.label}
            className="bg-card border-border hover:border-primary/50 p-5 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-muted-foreground text-sm">{stat.label}</p>
                <p className="font-mono text-3xl font-semibold">{stat.value}</p>
              </div>
              <Icon className="text-muted-foreground size-5" />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

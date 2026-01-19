import { Card } from "@/components/ui/card";
import type { SerializedWorkflowRun } from "@/types";
import {
  CheckCircle,
  Clock,
  Hourglass,
  Pulse,
  XCircle,
} from "@phosphor-icons/react";

export interface WorkflowStatsProps {
  runs: SerializedWorkflowRun[];
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
      change: "-",
      positive: false,
    },
    {
      label: "Completed",
      value: completed.toLocaleString(),
      icon: CheckCircle,
      change: "-",
      positive: false,
    },
    {
      label: "Running",
      value: running.toLocaleString(),
      icon: Clock,
      change: "-",
      positive: false,
    },
    {
      label: "Failed",
      value: failed.toLocaleString(),
      icon: XCircle,
      change: "-",
      positive: false,
    },
  ];

  const additionalStats = [];
  if (sleeping > 0) {
    additionalStats.push({
      label: "Sleeping",
      value: sleeping.toLocaleString(),
      icon: Hourglass,
      change: "-",
      positive: false,
    });
  }
  if (pending > 0) {
    additionalStats.push({
      label: "Pending",
      value: pending.toLocaleString(),
      icon: Clock,
      change: "-",
      positive: false,
    });
  }
  if (canceled > 0) {
    additionalStats.push({
      label: "Canceled",
      value: canceled.toLocaleString(),
      icon: XCircle,
      change: "-",
      positive: false,
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
            <div className="mt-3">
              <span
                className={`text-sm font-medium ${stat.positive ? "text-green-500" : "text-muted-foreground"}`}
              >
                {stat.change}
              </span>
              <span className="text-muted-foreground ml-2 text-sm">
                vs last 24h
              </span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

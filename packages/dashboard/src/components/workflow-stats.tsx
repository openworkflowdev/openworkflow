import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  ClockIcon,
  HourglassIcon,
  ProhibitIcon,
  PulseIcon,
  XCircleIcon,
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
      icon: PulseIcon,
    },
    {
      label: "Pending",
      value: pending.toLocaleString(),
      icon: ClockIcon,
      class: "bg-warning/10 ring-warning/20",
    },
    {
      label: "Running",
      value: running.toLocaleString(),
      icon: ArrowsClockwiseIcon,
      class: "bg-info/10 ring-info/20",
    },
    {
      label: "Sleeping",
      value: sleeping.toLocaleString(),
      icon: HourglassIcon,
      class: "bg-sleeping/10 ring-sleeping/20",
    },
    {
      label: "Completed",
      value: completed.toLocaleString(),
      icon: CheckCircleIcon,
      class: "bg-success/10 ring-success/20",
    },
    {
      label: "Failed",
      value: failed.toLocaleString(),
      icon: XCircleIcon,
      class: "bg-destructive/10 ring-destructive/20",
    },
    {
      label: "Canceled",
      value: canceled.toLocaleString(),
      icon: ProhibitIcon,
      class: "bg-neutral/10 ring-neutral/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-7">
      {stats.map((stat, index) => {
        const Icon = stat.icon;
        return (
          <Card
            key={stat.label}
            className={cn(
              "bg-card p-3 transition-colors sm:p-5",
              index === 0 &&
                "col-span-2 sm:col-span-3 lg:col-span-2 xl:col-span-1",
              stat.class,
            )}
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs sm:text-sm">
                  {stat.label}
                </p>
                <p className="font-mono text-2xl font-semibold sm:text-3xl">
                  {stat.value}
                </p>
              </div>
              <Icon className="text-muted-foreground size-4 sm:size-5" />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

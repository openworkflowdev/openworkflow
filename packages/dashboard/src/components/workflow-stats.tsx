import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  ClockIcon,
  ProhibitIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { WorkflowRunCounts } from "openworkflow/internal";

export interface WorkflowStatsProps {
  workflowRunCounts: WorkflowRunCounts;
}

export function WorkflowStats({ workflowRunCounts }: WorkflowStatsProps) {
  const { pending, running, completed, failed, canceled } = workflowRunCounts;

  const stats = [
    {
      label: "Pending",
      value: pending.toLocaleString(),
      icon: ClockIcon,
    },
    {
      label: "Running",
      value: running.toLocaleString(),
      icon: ArrowsClockwiseIcon,
      class: "bg-info/10 ring-info/20",
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 xl:grid-cols-5">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card
            key={stat.label}
            className={cn("bg-card p-3 transition-colors sm:p-5", stat.class)}
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

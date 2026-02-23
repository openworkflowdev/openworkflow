import { Card } from "@/components/ui/card";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  ClockIcon,
  HourglassIcon,
  ProhibitIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { WorkflowRunCounts } from "openworkflow/internal";

export interface WorkflowStatsProps {
  workflowRunCounts: WorkflowRunCounts;
}

export function WorkflowStats({ workflowRunCounts }: WorkflowStatsProps) {
  const { pending, running, sleeping, completed, failed, canceled } =
    workflowRunCounts;

  const stats = [
    { label: "Pending", value: pending.toLocaleString(), icon: ClockIcon },
    {
      label: "Running",
      value: running.toLocaleString(),
      icon: ArrowsClockwiseIcon,
    },
    {
      label: "Sleeping",
      value: sleeping.toLocaleString(),
      icon: HourglassIcon,
    },
    {
      label: "Completed",
      value: completed.toLocaleString(),
      icon: CheckCircleIcon,
    },
    {
      label: "Failed",
      value: failed.toLocaleString(),
      icon: XCircleIcon,
    },
    {
      label: "Canceled",
      value: canceled.toLocaleString(),
      icon: ProhibitIcon,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 xl:grid-cols-6">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card
            key={stat.label}
            className="bg-card border-border hover:border-primary/50 p-3 transition-colors sm:p-5"
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

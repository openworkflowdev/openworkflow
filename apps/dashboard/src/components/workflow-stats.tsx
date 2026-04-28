import { Card } from "@/components/ui/card";
import {
  getRunStatusConfig,
  getStatusStatCardClass,
  getStatusStatIconClass,
} from "@/lib/status";
import { cn } from "@/lib/utils";
import type { WorkflowRunCounts } from "openworkflow/internal";

export interface WorkflowStatsProps {
  workflowRunCounts: WorkflowRunCounts;
}

const STATS_STATUS_ORDER = [
  "pending",
  "running",
  "completed",
  "failed",
  "canceled",
] as const satisfies readonly (keyof WorkflowRunCounts)[];

export function WorkflowStats({ workflowRunCounts }: WorkflowStatsProps) {
  const stats = STATS_STATUS_ORDER.map((status) => {
    const config = getRunStatusConfig(status);

    return {
      status,
      label: config.label,
      value: workflowRunCounts[status].toLocaleString(),
      icon: config.statsIcon,
      cardClass: getStatusStatCardClass(status),
      iconClass: getStatusStatIconClass(status),
    };
  });

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 xl:grid-cols-5">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card
            key={stat.label}
            className={cn(
              "bg-card p-3 transition-colors sm:p-5",
              stat.cardClass,
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
              <Icon className={cn("size-4 sm:size-5", stat.iconClass)} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

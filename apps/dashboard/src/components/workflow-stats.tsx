import { Card } from "@/components/ui/card";
import { RUN_FILTER_STATUSES, type RunFilterStatus } from "@/lib/run-filters";
import {
  getRunStatusConfig,
  getStatusStatCardClass,
  getStatusStatIconClass,
} from "@/lib/status";
import { cn } from "@/lib/utils";
import type { WorkflowRunCounts } from "openworkflow/internal";

export interface WorkflowStatsProps {
  workflowRunCounts: WorkflowRunCounts;
  selectedStatus: RunFilterStatus | undefined;
  onStatusChange: (status: RunFilterStatus | undefined) => void;
}

export function WorkflowStats({
  workflowRunCounts,
  selectedStatus,
  onStatusChange,
}: WorkflowStatsProps) {
  const stats = RUN_FILTER_STATUSES.map((status) => {
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
              "bg-card p-0 transition-colors",
              stat.cardClass,
              selectedStatus === stat.status && "ring-foreground/60 ring-2",
            )}
          >
            <button
              type="button"
              aria-label={`Filter ${stat.label.toLowerCase()} runs`}
              aria-pressed={selectedStatus === stat.status}
              className="hover:bg-foreground/5 focus-visible:ring-ring flex w-full cursor-pointer items-start justify-between p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset sm:p-5"
              onClick={() => {
                onStatusChange(
                  selectedStatus === stat.status ? undefined : stat.status,
                );
              }}
            >
              <span className="space-y-1">
                <span className="text-muted-foreground block text-xs sm:text-sm">
                  {stat.label}
                </span>
                <span className="block font-mono text-2xl font-semibold sm:text-3xl">
                  {stat.value}
                </span>
              </span>
              <Icon className={cn("size-4 sm:size-5", stat.iconClass)} />
            </button>
          </Card>
        );
      })}
    </div>
  );
}

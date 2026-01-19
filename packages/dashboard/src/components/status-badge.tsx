import { Badge } from "./ui/badge";
import { STATUS_CONFIG } from "@/lib/status";
import type { WorkflowRunStatus } from "openworkflow/internal";

interface StatusBadgeProps {
  status: WorkflowRunStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const { label, icon: Icon, badgeClass } = STATUS_CONFIG[status];

  return (
    <Badge variant="outline" className={badgeClass}>
      <Icon className="mr-1 h-3 w-3" weight="fill" />
      {label}
    </Badge>
  );
}

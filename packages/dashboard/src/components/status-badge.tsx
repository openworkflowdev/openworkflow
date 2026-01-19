import { Badge } from "./ui/badge";
import { CheckCircle, Circle, Clock, XCircle } from "@phosphor-icons/react";
import type { WorkflowRunStatus } from "openworkflow/internal";

interface StatusBadgeProps {
  status: WorkflowRunStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config: Record<
    WorkflowRunStatus,
    { label: string; icon: typeof CheckCircle; className: string }
  > = {
    pending: {
      label: "Pending",
      icon: Clock,
      className: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    },
    running: {
      label: "Running",
      icon: Circle,
      className: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    },
    sleeping: {
      label: "Sleeping",
      icon: Clock,
      className: "bg-purple-500/10 text-purple-500 border-purple-500/20",
    },
    succeeded: {
      label: "Succeeded",
      icon: CheckCircle,
      className: "bg-green-500/10 text-green-500 border-green-500/20",
    },
    completed: {
      label: "Completed",
      icon: CheckCircle,
      className: "bg-green-500/10 text-green-500 border-green-500/20",
    },
    failed: {
      label: "Failed",
      icon: XCircle,
      className: "bg-red-500/10 text-red-500 border-red-500/20",
    },
    canceled: {
      label: "Canceled",
      icon: XCircle,
      className: "bg-gray-500/10 text-gray-500 border-gray-500/20",
    },
  };

  const { label, icon: Icon, className } = config[status];

  return (
    <Badge variant="outline" className={className}>
      <Icon className="mr-1 h-3 w-3" weight="fill" />
      {label}
    </Badge>
  );
}

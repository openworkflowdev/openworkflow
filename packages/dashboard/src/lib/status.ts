import {
  CheckCircle,
  CircleNotch,
  Clock,
  Hourglass,
  Prohibit,
  XCircle,
} from "@phosphor-icons/react";
import type {
  WorkflowRunStatus,
  StepAttemptStatus,
} from "openworkflow/internal";

export const STATUS_CONFIG: Record<
  WorkflowRunStatus,
  {
    icon: typeof CheckCircle;
    color: string;
    label: string;
    badgeClass: string;
  }
> = {
  completed: {
    icon: CheckCircle,
    color: "text-green-500",
    label: "Completed",
    badgeClass: "bg-green-500/10 text-green-500 border-green-500/20",
  },
  succeeded: {
    icon: CheckCircle,
    color: "text-green-500",
    label: "Completed",
    badgeClass: "bg-green-500/10 text-green-500 border-green-500/20",
  },
  running: {
    // use the spinning notch for running states to match existing UI patterns
    icon: CircleNotch,
    color: "text-blue-500",
    label: "Running",
    badgeClass: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  },
  failed: {
    icon: XCircle,
    color: "text-red-500",
    label: "Failed",
    badgeClass: "bg-red-500/10 text-red-500 border-red-500/20",
  },
  pending: {
    icon: Clock,
    color: "text-yellow-500",
    label: "Pending",
    badgeClass: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  },
  sleeping: {
    icon: Hourglass,
    color: "text-purple-500",
    label: "Sleeping",
    badgeClass: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  },
  canceled: {
    icon: Prohibit,
    color: "text-gray-500",
    label: "Canceled",
    badgeClass: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  },
};

export const STEP_STATUS_CONFIG: Record<
  StepAttemptStatus,
  { icon: typeof CheckCircle; color: string }
> = {
  completed: {
    icon: STATUS_CONFIG.completed.icon,
    color: STATUS_CONFIG.completed.color,
  },
  succeeded: {
    icon: STATUS_CONFIG.succeeded.icon,
    color: STATUS_CONFIG.succeeded.color,
  },
  running: {
    icon: STATUS_CONFIG.running.icon,
    color: STATUS_CONFIG.running.color,
  },
  failed: {
    icon: STATUS_CONFIG.failed.icon,
    color: STATUS_CONFIG.failed.color,
  },
};

export function getStatusColor(status: string): string {
  return (
    (STATUS_CONFIG as Record<string, any>)[status]?.color ?? "text-yellow-500"
  );
}

export function getStatusBadgeClass(status: string): string {
  return (
    (STATUS_CONFIG as Record<string, any>)[status]?.badgeClass ??
    "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
  );
}

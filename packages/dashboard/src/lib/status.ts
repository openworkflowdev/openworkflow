import {
  CheckCircleIcon,
  CircleNotchIcon,
  ClockIcon,
  HourglassIcon,
  ProhibitIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type {
  WorkflowRunStatus,
  StepAttemptStatus,
} from "openworkflow/internal";

export const STATUS_CONFIG: Record<
  WorkflowRunStatus,
  {
    icon: typeof CheckCircleIcon;
    color: string;
    label: string;
    badgeClass: string;
  }
> = {
  completed: {
    icon: CheckCircleIcon,
    color: "text-green-500",
    label: "Completed",
    badgeClass: "bg-green-500/10 text-green-500 border-green-500/20",
  },
  succeeded: {
    icon: CheckCircleIcon,
    color: "text-green-500",
    label: "Completed",
    badgeClass: "bg-green-500/10 text-green-500 border-green-500/20",
  },
  running: {
    // use the spinning notch for running states to match existing UI patterns
    icon: CircleNotchIcon,
    color: "text-blue-500",
    label: "Running",
    badgeClass: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  },
  failed: {
    icon: XCircleIcon,
    color: "text-red-500",
    label: "Failed",
    badgeClass: "bg-red-500/10 text-red-500 border-red-500/20",
  },
  pending: {
    icon: ClockIcon,
    color: "text-yellow-500",
    label: "Pending",
    badgeClass: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  },
  sleeping: {
    icon: HourglassIcon,
    color: "text-purple-500",
    label: "Sleeping",
    badgeClass: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  },
  canceled: {
    icon: ProhibitIcon,
    color: "text-gray-500",
    label: "Canceled",
    badgeClass: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  },
};

export const STEP_STATUS_CONFIG: Record<
  StepAttemptStatus,
  { icon: typeof CheckCircleIcon; color: string }
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

/** Run statuses that represent a finished workflow (no further updates expected). */
export const TERMINAL_RUN_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set([
  "completed",
  "succeeded",
  "failed",
  "canceled",
]);

const fallbackStatusColor = "text-yellow-500";
const fallbackStatusBadgeClass =
  "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";

function getStatusConfig(status: string) {
  if (!(status in STATUS_CONFIG)) {
    return;
  }

  return STATUS_CONFIG[status as WorkflowRunStatus];
}

export function getStatusColor(status: string): string {
  return getStatusConfig(status)?.color ?? fallbackStatusColor;
}

export function getStatusBadgeClass(status: string): string {
  return getStatusConfig(status)?.badgeClass ?? fallbackStatusBadgeClass;
}

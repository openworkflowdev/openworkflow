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
    color: "text-success",
    label: "Completed",
    badgeClass: "bg-success/10 border-success/20 text-success",
  },
  succeeded: {
    icon: CheckCircleIcon,
    color: "text-success",
    label: "Completed",
    badgeClass: "bg-success/10 border-success/20 text-success",
  },
  running: {
    // use the spinning notch for running states to match existing UI patterns
    icon: CircleNotchIcon,
    color: "text-info",
    label: "Running",
    badgeClass: "bg-info/10 border-info/20 text-info",
  },
  failed: {
    icon: XCircleIcon,
    color: "text-destructive",
    label: "Failed",
    badgeClass: "bg-destructive/10 border-destructive/20 text-destructive",
  },
  pending: {
    icon: ClockIcon,
    color: "text-warning",
    label: "Pending",
    badgeClass: "bg-warning/10 border-warning/20 text-warning",
  },
  sleeping: {
    icon: HourglassIcon,
    color: "text-sleeping",
    label: "Sleeping",
    badgeClass: "bg-sleeping/10 border-sleeping/20 text-sleeping",
  },
  canceled: {
    icon: ProhibitIcon,
    color: "text-neutral",
    label: "Canceled",
    badgeClass: "bg-neutral/10 border-neutral/20 text-neutral",
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

/** Run statuses that can be canceled from the dashboard. */
const CANCELABLE_RUN_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set([
  "pending",
  "running",
  "sleeping",
]);

const fallbackStatusColor = "text-warning";
const fallbackStatusBadgeClass = "bg-warning/10 border-warning/20 text-warning";

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

export function isRunCancelableStatus(status: string): boolean {
  return CANCELABLE_RUN_STATUSES.has(status as WorkflowRunStatus);
}

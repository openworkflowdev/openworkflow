import {
  ArrowsClockwiseIcon,
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

interface StatusUiTone {
  color: string;
  badgeClass: string;
  statCardClass: string;
  statIconClass: string;
}

const STATUS_UI_TONES = {
  success: {
    color: "text-success",
    badgeClass: "bg-success/10 border-success/20 text-success",
    statCardClass: "bg-success/10 ring-success/20",
    statIconClass: "text-success/80",
  },
  info: {
    color: "text-info",
    badgeClass: "bg-info/10 border-info/20 text-info",
    statCardClass: "bg-info/10 ring-info/20",
    statIconClass: "text-info/80",
  },
  destructive: {
    color: "text-destructive",
    badgeClass: "bg-destructive/10 border-destructive/20 text-destructive",
    statCardClass: "bg-destructive/10 ring-destructive/20",
    statIconClass: "text-destructive/80",
  },
  warning: {
    color: "text-warning",
    badgeClass: "bg-warning/10 border-warning/20 text-warning",
    statCardClass: "bg-warning/10 ring-warning/20",
    statIconClass: "text-warning/80",
  },
  sleeping: {
    color: "text-sleeping",
    badgeClass: "bg-sleeping/10 border-sleeping/20 text-sleeping",
    statCardClass: "bg-sleeping/10 ring-sleeping/20",
    statIconClass: "text-sleeping/80",
  },
  neutral: {
    color: "text-neutral",
    badgeClass: "bg-neutral/10 border-neutral/20 text-neutral",
    statCardClass: "bg-neutral/10 ring-neutral/20",
    statIconClass: "text-neutral/80",
  },
} as const satisfies Record<string, StatusUiTone>;

type StatusUiToneKey = keyof typeof STATUS_UI_TONES;

interface StatusConfig {
  icon: typeof CheckCircleIcon;
  statsIcon: typeof CheckCircleIcon;
  label: string;
  color: string;
  badgeClass: string;
  statCardClass: string;
  statIconClass: string;
}

function makeStatusConfig(input: {
  icon: typeof CheckCircleIcon;
  label: string;
  tone: StatusUiToneKey;
  statsIcon?: typeof CheckCircleIcon;
}): StatusConfig {
  const tone = STATUS_UI_TONES[input.tone];

  return {
    icon: input.icon,
    statsIcon: input.statsIcon ?? input.icon,
    label: input.label,
    color: tone.color,
    badgeClass: tone.badgeClass,
    statCardClass: tone.statCardClass,
    statIconClass: tone.statIconClass,
  };
}

const STATUS_CONFIG: Record<WorkflowRunStatus, StatusConfig> = {
  completed: makeStatusConfig({
    icon: CheckCircleIcon,
    label: "Completed",
    tone: "success",
  }),
  succeeded: makeStatusConfig({
    icon: CheckCircleIcon,
    label: "Completed",
    tone: "success",
  }),
  running: makeStatusConfig({
    // use the spinning notch for running states to match existing UI patterns
    icon: CircleNotchIcon,
    statsIcon: ArrowsClockwiseIcon,
    label: "Running",
    tone: "info",
  }),
  failed: makeStatusConfig({
    icon: XCircleIcon,
    label: "Failed",
    tone: "destructive",
  }),
  pending: makeStatusConfig({
    icon: ClockIcon,
    label: "Pending",
    tone: "warning",
  }),
  sleeping: makeStatusConfig({
    // legacy status kept for backward compatibility
    icon: HourglassIcon,
    label: "Sleeping",
    tone: "sleeping",
  }),
  canceled: makeStatusConfig({
    icon: ProhibitIcon,
    label: "Canceled",
    tone: "neutral",
  }),
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
  // legacy status kept for backward compatibility
  "succeeded",
  "failed",
  "canceled",
]);

/** Run statuses that can be canceled from the dashboard. */
const CANCELABLE_RUN_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set([
  "pending",
  "running",
  // legacy status kept for backward compatibility
  "sleeping",
]);

const fallbackStatusConfig = STATUS_CONFIG.pending;

export function getRunStatusConfig(status: string): StatusConfig {
  if (!(status in STATUS_CONFIG)) {
    return fallbackStatusConfig;
  }

  return STATUS_CONFIG[status as WorkflowRunStatus];
}

export function getStatusColor(status: string): string {
  return getRunStatusConfig(status).color;
}

export function getStatusBadgeClass(status: string): string {
  return getRunStatusConfig(status).badgeClass;
}

export function getStatusStatCardClass(status: string): string {
  return getRunStatusConfig(status).statCardClass;
}

export function getStatusStatIconClass(status: string): string {
  return getRunStatusConfig(status).statIconClass;
}

export function isRunCancelableStatus(status: string): boolean {
  return CANCELABLE_RUN_STATUSES.has(status as WorkflowRunStatus);
}

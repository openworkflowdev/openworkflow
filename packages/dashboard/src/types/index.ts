// Derive status types from the serialized types
import type { SerializedStepAttempt, SerializedWorkflowRun } from "@/lib/api";

// Re-export real types from openworkflow for use in components
export type { StepAttempt, WorkflowRun } from "openworkflow/internal";

// Re-export serialized types for client-side use (after JSON transport)
export type { SerializedStepAttempt, SerializedWorkflowRun } from "@/lib/api";

export type StepAttemptStatus = SerializedStepAttempt["status"];
export type WorkflowRunStatus = SerializedWorkflowRun["status"];
export type StepKind = SerializedStepAttempt["kind"];

/**
 * Compute a human-readable duration between two date strings.
 * @param startedAt - ISO date string when the run/step started
 * @param finishedAt - ISO date string when the run/step finished (or null if still running)
 * @returns Human-readable duration string (e.g., "1.2s", "5m 30s") or "-" if not applicable
 */
export function computeDuration(
  startedAt: string | null,
  finishedAt: string | null,
): string {
  if (!startedAt || !finishedAt) {
    return "-";
  }

  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  const durationMs = end - start;

  if (durationMs < 0) {
    return "-";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);

  if (seconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${seconds}s`;
}

/**
 * Format a relative time string from an ISO date string.
 * @param isoDate - ISO date string
 * @returns Human-readable relative time (e.g., "2m ago", "1h ago")
 */
export function formatRelativeTime(isoDate: string | null): string {
  if (!isoDate) {
    return "-";
  }

  const date = new Date(isoDate);
  const now = Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 0) {
    return "just now";
  }

  if (diffMs < 60_000) {
    const seconds = Math.round(diffMs / 1000);
    return `${seconds}s ago`;
  }

  if (diffMs < 3_600_000) {
    const minutes = Math.round(diffMs / 60_000);
    return `${minutes}m ago`;
  }

  if (diffMs < 86_400_000) {
    const hours = Math.round(diffMs / 3_600_000);
    return `${hours}h ago`;
  }

  const days = Math.round(diffMs / 86_400_000);
  return `${days}d ago`;
}

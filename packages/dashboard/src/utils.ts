/**
 * Compute a human-readable duration between two dates.
 * @param startedAt - Date when the run/step started
 * @param finishedAt - Date when the run/step finished (or null if still running)
 * @returns Human-readable duration string (e.g., "1.2s", "5m 30s") or "-" if not applicable
 */
export function computeDuration(
  startedAt: Date | null,
  finishedAt: Date | null,
): string {
  if (!startedAt || !finishedAt) {
    return "-";
  }

  const durationMs = finishedAt.getTime() - startedAt.getTime();

  if (durationMs < 0) {
    return "< 1ms";
  }

  if (durationMs < 1000) {
    return `${durationMs.toString()}ms`;
  }

  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);

  if (seconds === 0) {
    return `${minutes.toString()}m`;
  }

  return `${minutes.toString()}m ${seconds.toString()}s`;
}

/**
 * Format a relative time string from a Date.
 * @param date - Date object
 * @returns Human-readable relative time (e.g., "2m ago", "1h ago")
 */
export function formatRelativeTime(date: Date | null): string {
  if (!date) {
    return "-";
  }

  const now = Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 0) {
    return "just now";
  }

  if (diffMs < 60_000) {
    const seconds = Math.round(diffMs / 1000);
    return `${seconds.toString()}s ago`;
  }

  if (diffMs < 3_600_000) {
    const minutes = Math.round(diffMs / 60_000);
    return `${minutes.toString()}m ago`;
  }

  if (diffMs < 86_400_000) {
    const hours = Math.round(diffMs / 3_600_000);
    return `${hours.toString()}h ago`;
  }

  const days = Math.round(diffMs / 86_400_000);
  return `${days.toString()}d ago`;
}

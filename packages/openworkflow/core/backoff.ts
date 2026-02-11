import type { DurationString } from "./duration.js";
import { parseDuration } from "./duration.js";

/**
 * Shared exponential backoff configuration.
 */
export interface BackoffPolicy {
  readonly initialInterval: DurationString;
  readonly backoffCoefficient: number;
  readonly maximumInterval: DurationString;
}

/**
 * Compute capped exponential backoff for a 1-based attempt number.
 * @param policy - Backoff policy
 * @param attempt - Attempt number (attempt 1 uses initial interval)
 * @returns Delay in milliseconds
 */
export function computeBackoffDelayMs(
  policy: BackoffPolicy,
  attempt: number,
): number {
  const initialIntervalMs = parseBackoffIntervalMs(policy.initialInterval);
  const maximumIntervalMs = parseBackoffIntervalMs(policy.maximumInterval);

  const exponentialBackoffMs =
    initialIntervalMs *
    Math.pow(policy.backoffCoefficient, Math.max(0, attempt - 1));

  return Math.min(exponentialBackoffMs, maximumIntervalMs);
}

/**
 * Parse a backoff interval duration string into milliseconds.
 * Invalid runtime values default to 0ms.
 * @param interval - Duration string
 * @returns Interval in milliseconds
 */
function parseBackoffIntervalMs(interval: DurationString): number {
  const parsedInterval = parseDuration(interval);
  return parsedInterval.ok ? parsedInterval.value : 0;
}

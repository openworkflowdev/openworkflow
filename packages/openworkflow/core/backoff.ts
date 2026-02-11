/**
 * Shared exponential backoff configuration.
 */
export interface BackoffPolicy {
  readonly initialIntervalMs: number;
  readonly backoffCoefficient: number;
  readonly maximumIntervalMs: number;
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
  const exponentialBackoffMs =
    policy.initialIntervalMs *
    Math.pow(policy.backoffCoefficient, Math.max(0, attempt - 1));

  return Math.min(exponentialBackoffMs, policy.maximumIntervalMs);
}

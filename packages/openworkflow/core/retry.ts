export const DEFAULT_RETRY_POLICY = {
  initialIntervalMs: 1000, // 1s
  backoffCoefficient: 2,
  maximumIntervalMs: 100 * 1000, // 100s
  maximumAttempts: Infinity, // unlimited
} as const;

export type RetryPolicy = typeof DEFAULT_RETRY_POLICY;

/**
 * Calculate the next retry delay using exponential backoff.
 * @param attemptNumber - Attempt number (1-based)
 * @returns Delay in milliseconds
 */
export function calculateRetryDelayMs(attemptNumber: number): number {
  const { initialIntervalMs, backoffCoefficient, maximumIntervalMs } =
    DEFAULT_RETRY_POLICY;

  const backoffMs =
    initialIntervalMs * Math.pow(backoffCoefficient, attemptNumber - 1);

  return Math.min(backoffMs, maximumIntervalMs);
}

/**
 * Check if an operation should be retried based on the retry policy.
 * @param retryPolicy - Retry policy
 * @param attemptNumber - Attempt number (1-based)
 * @returns True if another attempt should be made
 */
export function shouldRetry(
  retryPolicy: RetryPolicy,
  attemptNumber: number,
): boolean {
  return attemptNumber < retryPolicy.maximumAttempts;
}

export const DEFAULT_RETRY_POLICY = {
  initialIntervalMs: 1000, // 1s
  backoffCoefficient: 2,
  maximumIntervalMs: 100 * 1000, // 100s
  maximumAttempts: Infinity, // unlimited
} as const;

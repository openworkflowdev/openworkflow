import {
  calculateRetryDelayMs,
  DEFAULT_RETRY_POLICY,
  shouldRetry,
} from "./index.js";
import { describe, expect, test } from "vitest";

describe("calculateRetryDelayMs", () => {
  test("calculates exponential backoff correctly", () => {
    expect(calculateRetryDelayMs(1)).toBe(1000);
    expect(calculateRetryDelayMs(2)).toBe(2000);
    expect(calculateRetryDelayMs(3)).toBe(4000);
    expect(calculateRetryDelayMs(4)).toBe(8000);
    expect(calculateRetryDelayMs(5)).toBe(16_000);
    expect(calculateRetryDelayMs(6)).toBe(32_000);
    expect(calculateRetryDelayMs(7)).toBe(64_000);
  });

  test("caps delay at maximum interval", () => {
    const { maximumIntervalMs } = DEFAULT_RETRY_POLICY;

    // attempt 8: 1s * 2^7 = 128s = 128000ms, but capped at 100000ms (max)
    expect(calculateRetryDelayMs(8)).toBe(maximumIntervalMs);

    // attempts 10 & 100: should still be capped
    expect(calculateRetryDelayMs(10)).toBe(maximumIntervalMs);
    expect(calculateRetryDelayMs(100)).toBe(maximumIntervalMs);
  });

  test("handles edge cases", () => {
    // attempt 0: 1s * 2^-1 = 0.5s = 500ms
    expect(calculateRetryDelayMs(0)).toBe(500);
    expect(calculateRetryDelayMs(Infinity)).toBe(100_000);
  });
});

describe("shouldRetry", () => {
  test("always returns true with default policy (infinite retries)", () => {
    const retryPolicy = DEFAULT_RETRY_POLICY;
    expect(shouldRetry(retryPolicy, 1)).toBe(true);
    expect(shouldRetry(retryPolicy, 10)).toBe(true);
    expect(shouldRetry(retryPolicy, 100)).toBe(true);
    expect(shouldRetry(retryPolicy, 1000)).toBe(true);
  });
});

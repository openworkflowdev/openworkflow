import { computeBackoffDelayMs } from "./backoff.js";
import { describe, expect, test } from "vitest";

describe("computeBackoffDelayMs", () => {
  test("treats attempt 0 like attempt 1", () => {
    const delayMs = computeBackoffDelayMs(
      {
        initialIntervalMs: 1000,
        backoffCoefficient: 2,
        maximumIntervalMs: 10_000,
      },
      0,
    );

    expect(delayMs).toBe(1000);
  });

  test("uses initial interval on attempt 1", () => {
    const delayMs = computeBackoffDelayMs(
      {
        initialIntervalMs: 250,
        backoffCoefficient: 3,
        maximumIntervalMs: 10_000,
      },
      1,
    );

    expect(delayMs).toBe(250);
  });

  test("stays constant when coefficient is 1", () => {
    const delayMs = computeBackoffDelayMs(
      {
        initialIntervalMs: 750,
        backoffCoefficient: 1,
        maximumIntervalMs: 10_000,
      },
      9,
    );

    expect(delayMs).toBe(750);
  });

  test("caps delay at maximum interval", () => {
    const delayMs = computeBackoffDelayMs(
      {
        initialIntervalMs: 1000,
        backoffCoefficient: 3,
        maximumIntervalMs: 5000,
      },
      4,
    );

    expect(delayMs).toBe(5000);
  });

  test("returns finite capped values for very large attempts", () => {
    const delayMs = computeBackoffDelayMs(
      {
        initialIntervalMs: 100,
        backoffCoefficient: 2,
        maximumIntervalMs: 60_000,
      },
      10_000,
    );

    expect(Number.isFinite(delayMs)).toBe(true);
    expect(delayMs).toBe(60_000);
  });
});

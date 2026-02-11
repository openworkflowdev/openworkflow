import { computeBackoffDelayMs } from "./backoff.js";
import { describe, expect, test } from "vitest";

describe("computeBackoffDelayMs", () => {
  test("treats attempt 0 like attempt 1", () => {
    const delayMs = computeBackoffDelayMs(
      {
        initialInterval: "1s",
        backoffCoefficient: 2,
        maximumInterval: "10s",
      },
      0,
    );

    expect(delayMs).toBe(1000);
  });

  test("uses initial interval on attempt 1", () => {
    const delayMs = computeBackoffDelayMs(
      {
        initialInterval: "250ms",
        backoffCoefficient: 3,
        maximumInterval: "10s",
      },
      1,
    );

    expect(delayMs).toBe(250);
  });

  test("stays constant when coefficient is 1", () => {
    const delayMs = computeBackoffDelayMs(
      {
        initialInterval: "750ms",
        backoffCoefficient: 1,
        maximumInterval: "10s",
      },
      9,
    );

    expect(delayMs).toBe(750);
  });

  test("caps delay at maximum interval", () => {
    const delayMs = computeBackoffDelayMs(
      {
        initialInterval: "1s",
        backoffCoefficient: 3,
        maximumInterval: "5s",
      },
      4,
    );

    expect(delayMs).toBe(5000);
  });

  test("returns finite capped values for very large attempts", () => {
    const delayMs = computeBackoffDelayMs(
      {
        initialInterval: "100ms",
        backoffCoefficient: 2,
        maximumInterval: "60s",
      },
      10_000,
    );

    expect(Number.isFinite(delayMs)).toBe(true);
    expect(delayMs).toBe(60_000);
  });
});

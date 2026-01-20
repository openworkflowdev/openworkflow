import { computeDuration, formatRelativeTime } from "./utils";
import { describe, expect, it } from "vitest";

describe("computeDuration", () => {
  it("returns '-' when startedAt is null", () => {
    const result = computeDuration(null, new Date());
    expect(result).toBe("-");
  });

  it("returns '-' when finishedAt is null", () => {
    const result = computeDuration(new Date(), null);
    expect(result).toBe("-");
  });

  it("returns '< 1ms' for negative duration (clock skew)", () => {
    const startedAt = new Date("2024-01-01T00:00:01.000Z");
    const finishedAt = new Date("2024-01-01T00:00:00.000Z");
    const result = computeDuration(startedAt, finishedAt);
    expect(result).toBe("< 1ms");
  });

  it("returns milliseconds for durations under 1 second", () => {
    const startedAt = new Date("2024-01-01T00:00:00.000Z");
    const finishedAt = new Date("2024-01-01T00:00:00.500Z");
    const result = computeDuration(startedAt, finishedAt);
    expect(result).toBe("500ms");
  });

  it("returns seconds with one decimal for durations under 1 minute", () => {
    const startedAt = new Date("2024-01-01T00:00:00.000Z");
    const finishedAt = new Date("2024-01-01T00:00:05.500Z");
    const result = computeDuration(startedAt, finishedAt);
    expect(result).toBe("5.5s");
  });

  it("returns minutes only when seconds are 0", () => {
    const startedAt = new Date("2024-01-01T00:00:00.000Z");
    const finishedAt = new Date("2024-01-01T00:02:00.000Z");
    const result = computeDuration(startedAt, finishedAt);
    expect(result).toBe("2m");
  });

  it("returns minutes and seconds for durations over 1 minute", () => {
    const startedAt = new Date("2024-01-01T00:00:00.000Z");
    const finishedAt = new Date("2024-01-01T00:02:30.000Z");
    const result = computeDuration(startedAt, finishedAt);
    expect(result).toBe("2m 30s");
  });

  it("rounds seconds when formatting minutes and seconds", () => {
    const startedAt = new Date("2024-01-01T00:00:00.000Z");
    const finishedAt = new Date("2024-01-01T00:02:30.600Z");
    const result = computeDuration(startedAt, finishedAt);
    expect(result).toBe("2m 31s");
  });

  it("handles 0ms duration", () => {
    const startedAt = new Date("2024-01-01T00:00:00.000Z");
    const finishedAt = new Date("2024-01-01T00:00:00.000Z");
    const result = computeDuration(startedAt, finishedAt);
    expect(result).toBe("0ms");
  });
});

describe("formatRelativeTime", () => {
  it("returns '-' when date is null", () => {
    const result = formatRelativeTime(null);
    expect(result).toBe("-");
  });

  it("returns 'just now' for future dates", () => {
    const futureDate = new Date(Date.now() + 1000);
    const result = formatRelativeTime(futureDate);
    expect(result).toBe("just now");
  });

  it("returns seconds for times under 1 minute", () => {
    const date = new Date(Date.now() - 30_000);
    const result = formatRelativeTime(date);
    expect(result).toBe("30s ago");
  });

  it("returns minutes for times under 1 hour", () => {
    const date = new Date(Date.now() - 5 * 60_000);
    const result = formatRelativeTime(date);
    expect(result).toBe("5m ago");
  });

  it("returns hours for times under 1 day", () => {
    const date = new Date(Date.now() - 3 * 3_600_000);
    const result = formatRelativeTime(date);
    expect(result).toBe("3h ago");
  });

  it("returns days for times over 1 day", () => {
    const date = new Date(Date.now() - 2 * 86_400_000);
    const result = formatRelativeTime(date);
    expect(result).toBe("2d ago");
  });
});

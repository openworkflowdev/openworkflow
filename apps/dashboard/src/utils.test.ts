import {
  computeDuration,
  formatMetadataTimestamp,
  formatRelativeTime,
  getListboxNavigationIndex,
} from "./utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("uses a provided reference time when present", () => {
    const result = formatRelativeTime(
      new Date("2024-01-01T23:59:00.000Z"),
      new Date("2024-01-02T00:00:00.000Z"),
    );
    expect(result).toBe("1m ago");
  });
});

describe("formatMetadataTimestamp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-02T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns placeholders when date is null", () => {
    const result = formatMetadataTimestamp(null);
    expect(result).toEqual({ relative: "-", iso: null });
  });

  it("returns both relative and ISO values when date is present", () => {
    const result = formatMetadataTimestamp(
      new Date("2024-01-01T23:59:00.000Z"),
    );
    expect(result).toEqual({
      relative: "1m ago",
      iso: "2024-01-01T23:59:00.000Z",
    });
  });

  it("uses a provided reference time for deterministic output", () => {
    const result = formatMetadataTimestamp(
      new Date("2024-01-01T23:59:00.000Z"),
      new Date("2024-01-02T00:00:00.000Z"),
    );
    expect(result).toEqual({
      relative: "1m ago",
      iso: "2024-01-01T23:59:00.000Z",
    });
  });
});

describe("getListboxNavigationIndex", () => {
  it("returns null when there are no options", () => {
    expect(getListboxNavigationIndex("ArrowDown", 0, 0)).toBeNull();
  });

  it("navigates down and wraps to the first option", () => {
    expect(getListboxNavigationIndex("ArrowDown", 0, 3)).toBe(1);
    expect(getListboxNavigationIndex("ArrowDown", 2, 3)).toBe(0);
  });

  it("navigates up and wraps to the last option", () => {
    expect(getListboxNavigationIndex("ArrowUp", 2, 3)).toBe(1);
    expect(getListboxNavigationIndex("ArrowUp", 0, 3)).toBe(2);
  });

  it("jumps to first/last option on Home/End", () => {
    expect(getListboxNavigationIndex("Home", 1, 3)).toBe(0);
    expect(getListboxNavigationIndex("End", 1, 3)).toBe(2);
  });

  it("returns null for unsupported keys", () => {
    expect(getListboxNavigationIndex("Enter", 1, 3)).toBeNull();
  });
});

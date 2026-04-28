// @vitest-environment jsdom
import { usePolling } from "./use-polling";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate }),
}));

describe("usePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invalidate.mockClear();
    Object.defineProperty(document, "hidden", {
      value: false,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("calls router.invalidate on the default interval", () => {
    renderHook(() => {
      usePolling();
    });

    expect(invalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(invalidate).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("respects a custom interval", () => {
    renderHook(() => {
      usePolling({ interval: 5000 });
    });

    vi.advanceTimersByTime(4999);
    expect(invalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("does not poll when enabled is false", () => {
    renderHook(() => {
      usePolling({ enabled: false });
    });

    vi.advanceTimersByTime(10_000);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("stops polling on unmount", () => {
    const { unmount } = renderHook(() => {
      usePolling();
    });

    vi.advanceTimersByTime(2000);
    expect(invalidate).toHaveBeenCalledTimes(1);

    unmount();

    vi.advanceTimersByTime(10_000);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("pauses polling when the tab is hidden", () => {
    renderHook(() => {
      usePolling();
    });

    vi.advanceTimersByTime(2000);
    expect(invalidate).toHaveBeenCalledTimes(1);

    // Simulate tab becoming hidden
    Object.defineProperty(document, "hidden", {
      value: true,
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    vi.advanceTimersByTime(10_000);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("does not start polling when mounted with the tab already hidden", () => {
    Object.defineProperty(document, "hidden", {
      value: true,
      writable: true,
      configurable: true,
    });

    renderHook(() => {
      usePolling();
    });

    vi.advanceTimersByTime(10_000);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("resumes polling and immediately invalidates when the tab becomes visible", () => {
    renderHook(() => {
      usePolling();
    });

    // Hide tab
    Object.defineProperty(document, "hidden", {
      value: true,
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    invalidate.mockClear();

    // Show tab again
    Object.defineProperty(document, "hidden", {
      value: false,
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Should immediately invalidate on visibility restore
    expect(invalidate).toHaveBeenCalledTimes(1);

    // And resume the interval
    vi.advanceTimersByTime(2000);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("starts polling when enabled changes from false to true", () => {
    const { rerender } = renderHook(
      ({ enabled }) => {
        usePolling({ enabled });
      },
      { initialProps: { enabled: false } },
    );

    vi.advanceTimersByTime(4000);
    expect(invalidate).not.toHaveBeenCalled();

    rerender({ enabled: true });

    vi.advanceTimersByTime(2000);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("stops polling when enabled changes from true to false", () => {
    const { rerender } = renderHook(
      ({ enabled }) => {
        usePolling({ enabled });
      },
      { initialProps: { enabled: true } },
    );

    vi.advanceTimersByTime(2000);
    expect(invalidate).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });

    vi.advanceTimersByTime(10_000);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

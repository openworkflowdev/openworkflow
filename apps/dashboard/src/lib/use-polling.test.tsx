// @vitest-environment jsdom
import { usePolling } from "./use-polling";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = createRouter({
  routeTree: createRootRoute(),
  history: createMemoryHistory(),
});
const invalidate = vi.spyOn(router, "invalidate").mockResolvedValue();

function wrapper({ children }: { children: ReactNode }) {
  return (
    <RouterContextProvider router={router}>{children}</RouterContextProvider>
  );
}

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
    renderHook(
      () => {
        usePolling();
      },
      { wrapper },
    );

    expect(invalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(invalidate).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("respects a custom interval", () => {
    renderHook(
      () => {
        usePolling({ interval: 5000 });
      },
      { wrapper },
    );

    vi.advanceTimersByTime(4999);
    expect(invalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("does not poll when enabled is false", () => {
    renderHook(
      () => {
        usePolling({ enabled: false });
      },
      { wrapper },
    );

    vi.advanceTimersByTime(10_000);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("stops polling on unmount", () => {
    const { unmount } = renderHook(
      () => {
        usePolling();
      },
      { wrapper },
    );

    vi.advanceTimersByTime(2000);
    expect(invalidate).toHaveBeenCalledTimes(1);

    unmount();

    vi.advanceTimersByTime(10_000);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("pauses polling when the tab is hidden", () => {
    renderHook(
      () => {
        usePolling();
      },
      { wrapper },
    );

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

    renderHook(
      () => {
        usePolling();
      },
      { wrapper },
    );

    vi.advanceTimersByTime(10_000);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("resumes polling and immediately invalidates when the tab becomes visible", () => {
    renderHook(
      () => {
        usePolling();
      },
      { wrapper },
    );

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
      { initialProps: { enabled: false }, wrapper },
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
      { initialProps: { enabled: true }, wrapper },
    );

    vi.advanceTimersByTime(2000);
    expect(invalidate).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });

    vi.advanceTimersByTime(10_000);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

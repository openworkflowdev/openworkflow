// @vitest-environment jsdom
import { useStepSelection } from "./use-step-selection";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { StepAttempt } from "openworkflow/internal";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";

type SelectableStep = Pick<StepAttempt, "id" | "status">;

describe("useStepSelection", () => {
  afterEach(cleanup);

  it("prefers failed steps, then running steps, then the last step", () => {
    const { result, rerender } = renderHook(useStepSelection, {
      initialProps: [
        { id: "failed", status: "failed" },
        { id: "running", status: "running" },
        { id: "last", status: "completed" },
      ] as SelectableStep[],
    });
    expect(result.current[0]).toBe("failed");

    rerender([
      { id: "running", status: "running" },
      { id: "last", status: "completed" },
    ]);
    expect(result.current[0]).toBe("running");

    rerender([
      { id: "first", status: "completed" },
      { id: "last", status: "completed" },
    ]);
    expect(result.current[0]).toBe("last");
  });

  it("preserves a user's selection across polling updates", () => {
    const steps: SelectableStep[] = [
      { id: "first", status: "completed" },
      { id: "last", status: "running" },
    ];
    const { result, rerender } = renderHook(useStepSelection, {
      initialProps: steps,
    });
    act(() => {
      result.current[1]("first");
    });

    rerender([...steps, { id: "new-failure", status: "failed" }]);
    expect(result.current[0]).toBe("first");
  });

  it("commits only a valid selection when pages change or become empty", () => {
    const committedSelections: (string | null)[] = [];
    const { result, rerender } = renderHook(
      (steps: SelectableStep[]) => {
        const selection = useStepSelection(steps);
        useLayoutEffect(() => {
          committedSelections.push(selection[0]);
        });
        return selection;
      },
      { initialProps: [{ id: "page-one", status: "completed" }] },
    );
    committedSelections.length = 0;

    rerender([{ id: "page-two", status: "running" }]);
    expect(committedSelections).toEqual(["page-two"]);

    committedSelections.length = 0;
    rerender([]);
    expect(committedSelections).toEqual([null]);

    rerender([{ id: "page-three", status: "completed" }]);
    expect(result.current[0]).toBe("page-three");
  });

  it("does not restore a discarded selection when that step returns", () => {
    const { result, rerender } = renderHook(useStepSelection, {
      initialProps: [{ id: "old", status: "failed" }] as SelectableStep[],
    });
    rerender([{ id: "replacement", status: "completed" }]);
    rerender([
      { id: "old", status: "failed" },
      { id: "replacement", status: "completed" },
    ]);
    expect(result.current[0]).toBe("replacement");
  });
});

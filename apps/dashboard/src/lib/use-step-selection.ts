import type { StepAttempt } from "openworkflow/internal";
import { useState } from "react";

type SelectableStep = Pick<StepAttempt, "id" | "status">;

export function useStepSelection(steps: readonly SelectableStep[]) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(() =>
    getDefaultSelectedStepId(steps),
  );

  const nextSelectedStepId = steps.some((step) => step.id === selectedStepId)
    ? selectedStepId
    : getDefaultSelectedStepId(steps);

  if (selectedStepId !== nextSelectedStepId) {
    setSelectedStepId(nextSelectedStepId);
  }

  return [selectedStepId, setSelectedStepId] as const;
}

function getDefaultSelectedStepId(
  steps: readonly SelectableStep[],
): string | null {
  const failedStep = steps.find((step) => step.status === "failed");
  if (failedStep) {
    return failedStep.id;
  }

  const runningStep = steps.find((step) => step.status === "running");
  if (runningStep) {
    return runningStep.id;
  }

  return steps.at(-1)?.id ?? null;
}

import type { WorkflowRun } from "openworkflow/internal";

/**
 * Parse an optional JSON workflow payload. Empty input means no payload.
 * @param value - JSON input from a dashboard form
 * @returns Parsed workflow input
 */
export function parseWorkflowInput(
  value: string | null | undefined,
): WorkflowRun["input"] {
  if (!value?.trim()) return null;
  try {
    // safety: JSON.parse without a reviver produces JSON-compatible workflow input.
    return JSON.parse(value) as WorkflowRun["input"];
  } catch {
    throw new TypeError("Input must be valid JSON");
  }
}

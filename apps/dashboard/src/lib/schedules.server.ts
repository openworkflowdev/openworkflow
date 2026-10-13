import { parseWorkflowInput } from "./input";
import { OpenWorkflow } from "openworkflow";
import type { Backend } from "openworkflow/internal";
import * as z from "zod";

export const scheduleInputSchema = z.object({
  id: z.string().min(1),
  workflowName: z.string().trim().min(1),
  cron: z.string().trim().min(1),
  timezone: z.string().trim().min(1),
  input: z.string(),
  mode: z.enum(["create", "edit"]),
});

/**
 * Save a schedule using the SDK's cron and timezone validation.
 * @param backend - Configured storage
 * @param data - Schedule form values
 * @returns Persisted schedule
 */
export async function saveWorkflowSchedule(
  backend: Backend,
  data: z.infer<typeof scheduleInputSchema>,
) {
  const ow = new OpenWorkflow({ backend });
  const existing = await ow.schedules.get(data.id);
  // These checks are best-effort; the v0.11 SDK saves schedules with an upsert.
  if (data.mode === "create" && existing) {
    throw new Error(
      "This schedule ID already exists. Use a different ID or edit the existing schedule.",
    );
  }
  if (data.mode === "edit" && !existing) {
    throw new Error("This schedule no longer exists. Refresh the page.");
  }
  return ow.scheduleWorkflow(
    { name: data.workflowName },
    parseWorkflowInput(data.input),
    { id: data.id, cron: data.cron, timezone: data.timezone },
  );
}

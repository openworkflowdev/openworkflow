import {
  validateRunsPaginationSearch,
  type RunsPaginationSearch,
} from "./runs-page-pagination";
import type { WorkflowRunCounts } from "openworkflow/internal";
import * as z from "zod";

export const RUN_FILTER_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "canceled",
] as const satisfies readonly (keyof WorkflowRunCounts)[];

export const runFiltersSchema = z.object({
  status: z.enum(RUN_FILTER_STATUSES).optional(),
  workflowName: z
    .string()
    .trim()
    .transform((value) => value || undefined)
    .optional(),
});

export type RunFilters = z.infer<typeof runFiltersSchema>;
export type RunFilterStatus = (typeof RUN_FILTER_STATUSES)[number];
export type RunsPageSearch = RunsPaginationSearch & RunFilters;

export function validateRunsSearch(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- URL search values are untrusted until validated
  search: unknown,
): RunsPageSearch {
  const pagination = validateRunsPaginationSearch(search);
  const filters = runFiltersSchema.safeParse(search);
  if (!filters.success) return pagination;
  return { ...pagination, ...filters.data };
}

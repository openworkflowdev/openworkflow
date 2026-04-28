import * as z from "zod";

export const RUNS_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export type RunsPageSize = (typeof RUNS_PAGE_SIZE_OPTIONS)[number];
const DEFAULT_RUNS_PAGE_SIZE: RunsPageSize = RUNS_PAGE_SIZE_OPTIONS[0];

const runsPaginationSearchSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  after: z.string().min(1).optional(),
  before: z.string().min(1).optional(),
});

export type RunsPaginationSearch = z.infer<typeof runsPaginationSearchSchema>;

export function validateRunsPaginationSearch(
  search: Record<string, unknown>,
): RunsPaginationSearch {
  const parsed = runsPaginationSearchSchema.safeParse(search);
  if (!parsed.success) {
    return {};
  }

  const sanitized: RunsPaginationSearch = { ...parsed.data };

  if (sanitized.after && sanitized.before) {
    delete sanitized.before;
  }

  return sanitized;
}

export function resolveRunsPageSize(limit?: number): RunsPageSize {
  if (RUNS_PAGE_SIZE_OPTIONS.includes(limit as RunsPageSize)) {
    return limit as RunsPageSize;
  }

  return DEFAULT_RUNS_PAGE_SIZE;
}

export const STEP_ATTEMPTS_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export type StepAttemptsPageSize =
  (typeof STEP_ATTEMPTS_PAGE_SIZE_OPTIONS)[number];

export function validateStepAttemptsPaginationSearch(
  search: Record<string, unknown>,
): RunsPaginationSearch {
  return validateRunsPaginationSearch(search);
}

export function resolveStepAttemptsPageSize(
  limit?: number,
): StepAttemptsPageSize {
  return resolveRunsPageSize(limit);
}

export interface CursorPaginationState {
  prev?: string | null;
  next?: string | null;
}

export function shouldShowPaginationControls(
  pagination: CursorPaginationState,
): boolean {
  const cursor = pagination.prev ?? pagination.next;
  return cursor !== null && cursor !== undefined;
}

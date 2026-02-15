import type { CreateWorkflowRunParams } from "./backend.js";

const INVALID_CONCURRENCY_KEY_TYPE_ERROR =
  'Invalid workflow concurrency metadata: "concurrencyKey" must be a string or null.';
export const INVALID_CONCURRENCY_KEY_VALUE_ERROR =
  'Invalid workflow concurrency metadata: "concurrencyKey" must be a non-empty string when provided.';
const INVALID_CONCURRENCY_LIMIT_TYPE_ERROR =
  'Invalid workflow concurrency metadata: "concurrencyLimit" must be a number or null.';
export const INVALID_CONCURRENCY_LIMIT_VALUE_ERROR =
  'Invalid workflow concurrency metadata: "concurrencyLimit" must be a positive integer or null.';
const INVALID_CONCURRENCY_PAIR_ERROR =
  'Invalid workflow concurrency metadata: "concurrencyLimit" must be set when "concurrencyKey" is provided.';
export const CONCURRENCY_LIMIT_MISMATCH_ERROR =
  'Invalid workflow concurrency metadata: active runs in the same bucket must use the same "concurrencyLimit".';

/**
 * Bucket identity for workflow-level concurrency.
 */
export interface ConcurrencyBucket {
  workflowName: string;
  version: string | null;
  key: string | null;
  limit: number;
}

/**
 * Normalize and validate workflow concurrency metadata passed to create calls.
 * This protects direct backend callers that bypass client-side validation.
 * @param params - Workflow run creation params
 * @returns Params with normalized concurrency fields
 * @throws {Error} When concurrency metadata has invalid shape or values
 */
export function normalizeCreateWorkflowRunParams(
  params: CreateWorkflowRunParams,
): CreateWorkflowRunParams {
  const rawParams = params as unknown as Record<string, unknown>;
  const rawConcurrencyKey = rawParams["concurrencyKey"];
  const rawConcurrencyLimit = rawParams["concurrencyLimit"];

  if (rawConcurrencyKey === undefined && rawConcurrencyLimit === undefined) {
    return {
      ...params,
      concurrencyKey: null,
      concurrencyLimit: null,
    };
  }

  if (
    rawConcurrencyKey !== undefined &&
    rawConcurrencyKey !== null &&
    typeof rawConcurrencyKey !== "string"
  ) {
    throw new Error(INVALID_CONCURRENCY_KEY_TYPE_ERROR);
  }

  if (
    rawConcurrencyLimit !== undefined &&
    rawConcurrencyLimit !== null &&
    typeof rawConcurrencyLimit !== "number"
  ) {
    throw new Error(INVALID_CONCURRENCY_LIMIT_TYPE_ERROR);
  }

  const concurrencyKey =
    rawConcurrencyKey === undefined ? null : rawConcurrencyKey;
  const concurrencyLimit =
    rawConcurrencyLimit === undefined ? null : rawConcurrencyLimit;

  if (concurrencyKey !== null && concurrencyLimit === null) {
    throw new Error(INVALID_CONCURRENCY_PAIR_ERROR);
  }

  if (
    typeof concurrencyKey === "string" &&
    concurrencyKey.trim().length === 0
  ) {
    throw new Error(INVALID_CONCURRENCY_KEY_VALUE_ERROR);
  }

  if (
    typeof concurrencyLimit === "number" &&
    (!Number.isFinite(concurrencyLimit) ||
      !Number.isInteger(concurrencyLimit) ||
      concurrencyLimit <= 0)
  ) {
    throw new Error(INVALID_CONCURRENCY_LIMIT_VALUE_ERROR);
  }

  return {
    ...params,
    concurrencyKey,
    concurrencyLimit,
  };
}

/**
 * Return bucket identity for constrained runs, otherwise null.
 * @param params - Normalized workflow run creation params
 * @returns Concurrency bucket or null for unconstrained runs
 */
export function toConcurrencyBucket(
  params: CreateWorkflowRunParams,
): ConcurrencyBucket | null {
  if (params.concurrencyLimit === null) {
    return null;
  }

  return {
    workflowName: params.workflowName,
    version: params.version,
    key: params.concurrencyKey,
    limit: params.concurrencyLimit,
  };
}

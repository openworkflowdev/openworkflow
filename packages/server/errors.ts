import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { BackendError } from "openworkflow/internal";
import { isBackendErrorCode } from "openworkflow/internal";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Server-internal error types and the single error-to-Response mapping.
// Route handlers throw; the global `app.onError` hook runs `errorToResponse`
// to produce a consistent wire shape across the entire API.
// ---------------------------------------------------------------------------

/**
 * Thrown by route handlers when a request fails validation (malformed JSON,
 * unknown/invalid fields, etc.). Maps to HTTP 400.
 */
export class HttpValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpValidationError";
  }
}

/**
 * The wire format for every error response returned by the server.
 * `code` is set only for typed `BackendError`s so clients can branch on it.
 */
export interface ErrorResponseBody {
  error: {
    message: string;
    code?: string;
  };
}

/**
 * Hook invoked for every unexpected server-side error. Intended for
 * structured logging / error reporting. `BackendError`, `HttpValidationError`,
 * and Hono's `HTTPException` (e.g. body-limit rejection) are expected outcomes
 * and are not forwarded here.
 */
export type ServerErrorHook = (
  error: unknown,
  context: { path: string; method: string },
) => void;

/** Options controlling {@link errorToResponse}'s behavior. */
export interface ErrorToResponseOptions {
  /** See CreateServerOptions.exposeInternalErrors. */
  exposeInternalErrors?: boolean;
  /** See CreateServerOptions.onError. */
  onError?: ServerErrorHook;
}

/**
 * Build the JSON Response for a caught error. Centralized so that every
 * handler — including the global `onError` — returns the same shape.
 * @param error - The caught error
 * @param c - Hono context (used only for `c.json`)
 * @param options - Behavior options
 * @returns JSON Response with status + body
 */
export function errorToResponse(
  error: unknown,
  c: Context,
  options: ErrorToResponseOptions = {},
): Response | Promise<Response> {
  if (error instanceof HttpValidationError) {
    return c.json<ErrorResponseBody, 400>(
      { error: { message: error.message } },
      400,
    );
  }

  if (isBackendError(error)) {
    const status = backendErrorStatus(error);
    return c.json<ErrorResponseBody>(
      { error: { message: error.message, code: error.code } },
      status,
    );
  }

  // Hono body-limit and similar middleware throw HTTPException — respect
  // their status/response and don't treat them as server errors.
  if (error instanceof HTTPException) {
    return error.getResponse();
  }

  // Anything else is unexpected: surface it to the caller for logging, and
  // either pass through a safe subset (Error.message) or scrub entirely,
  // depending on `exposeInternalErrors`.
  options.onError?.(error, { path: c.req.path, method: c.req.method });

  const message =
    options.exposeInternalErrors && error instanceof Error
      ? error.message
      : "Internal server error";
  return c.json<ErrorResponseBody, 500>({ error: { message } }, 500);
}

/**
 * Duck-typed {@link BackendError} check. We intentionally avoid `instanceof`
 * so the guard is robust across realms — the `BackendError` class may be
 * loaded from the compiled `openworkflow/internal` package in production and
 * from the TypeScript source in the monorepo under vitest.
 * @param error - Candidate error
 * @returns Whether the error is a BackendError with a recognized code
 */
function isBackendError(error: unknown): error is BackendError {
  if (!(error instanceof Error)) return false;
  if (error.name !== "BackendError") return false;
  const candidate = (error as { code?: unknown }).code;
  return typeof candidate === "string" && isBackendErrorCode(candidate);
}

/**
 * Map a `BackendError.code` to an HTTP status code.
 * @param error - The backend error
 * @returns HTTP status code
 */
function backendErrorStatus(error: BackendError): ContentfulStatusCode {
  switch (error.code) {
    case "NOT_FOUND": {
      return 404;
    }
    case "CONFLICT": {
      return 409;
    }
  }
}

/**
 * Parse a Hono request body and validate it against a Zod schema.
 * Throws `HttpValidationError` on malformed JSON or validation failure.
 * @param c - Hono context
 * @param schema - Zod schema describing the expected body
 * @returns Parsed and validated data
 */
export async function parseJsonBody<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpValidationError("Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpValidationError(z.prettifyError(parsed.error));
  }
  return parsed.data;
}

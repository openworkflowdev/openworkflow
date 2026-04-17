import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { BackendError } from "openworkflow/internal";
import { isBackendErrorCode } from "openworkflow/internal";
import { z } from "zod/v4";

// Route handlers throw; the global `app.onError` hook runs `errorToResponse`
// to produce a consistent wire shape for every error.

/** Thrown by route handlers on request validation failure. Maps to HTTP 400. */
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

/** Hook invoked for unexpected server-side errors (not `BackendError`/validation). */
export type ServerErrorHook = (
  error: unknown,
  context: { path: string; method: string },
) => void;

export interface ErrorToResponseOptions {
  exposeInternalErrors?: boolean;
  onError?: ServerErrorHook;
}

/**
 * Build the JSON Response for a caught error.
 * @param error - The caught error
 * @param c - Hono context
 * @param options - Behavior options
 * @returns JSON Response
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

  // Hono body-limit and similar middleware throw HTTPException. Preserve the
  // status/headers they chose, but normalize the body to the documented JSON
  // error wire shape so clients can parse every error response uniformly.
  if (error instanceof HTTPException) {
    const original = error.getResponse();
    const headers = new Headers(original.headers);
    headers.set("content-type", "application/json; charset=utf-8");
    const message = error.message || original.statusText || "HTTP error";
    const body: ErrorResponseBody = { error: { message } };
    return Response.json(body, {
      status: original.status,
      headers,
    });
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
 * Duck-typed BackendError guard — works across realms (TS source vs compiled).
 * @param error - The value to test
 * @returns True if `error` is a BackendError with a known code
 */
function isBackendError(error: unknown): error is BackendError {
  if (!(error instanceof Error)) return false;
  if (error.name !== "BackendError") return false;
  const candidate = (error as { code?: unknown }).code;
  return typeof candidate === "string" && isBackendErrorCode(candidate);
}

/**
 * Map a {@link BackendError} code to its HTTP status.
 * @param error - The backend error to map
 * @returns The HTTP status to return to the client
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
 * Parse and validate a request body against a Zod schema.
 * @param c - Hono context
 * @param schema - Zod schema
 * @returns Parsed data
 * @throws {HttpValidationError} On malformed JSON or schema failure.
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

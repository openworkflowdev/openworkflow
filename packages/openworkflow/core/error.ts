import type { JsonValue } from "./json.js";

export interface SerializedError {
  name?: string;
  message: string;
  stack?: string;
  [key: string]: JsonValue;
}

/**
 * Runtime tuple of every known Backend error code. Single source of truth —
 * the `BackendErrorCode` type is derived from this list so adding a code is
 * one edit.
 */
export const BACKEND_ERROR_CODES = ["NOT_FOUND", "CONFLICT"] as const;

/**
 * Error codes for typed Backend errors that can be mapped to HTTP status codes.
 */
export type BackendErrorCode = (typeof BACKEND_ERROR_CODES)[number];

/**
 * Type guard narrowing an arbitrary string to a known {@link BackendErrorCode}.
 * @param code - Candidate code string (e.g. from a server response)
 * @returns Whether `code` is a recognized backend error code
 */
export function isBackendErrorCode(code: string): code is BackendErrorCode {
  return (BACKEND_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * A typed error thrown by Backend implementations to signal well-known failure
 * modes. Consumers (e.g. the HTTP server) can inspect `code` to choose the
 * appropriate response status.
 */
// eslint-disable-next-line functional/no-classes, functional/no-class-inheritance
export class BackendError extends Error {
  readonly code: BackendErrorCode;

  constructor(code: BackendErrorCode, message: string) {
    super(message);
    this.name = "BackendError";
    this.code = code;
  }
}

/**
 * Serialize an error to a JSON-compatible format.
 * @param error - The error to serialize (can be Error instance or any value)
 * @returns A JSON-serializable error object
 */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const { name, message, stack } = error;

    if (stack) {
      return { name, message, stack };
    }

    return { name, message };
  }

  return {
    message: String(error),
  };
}

/**
 * Convert a serialized error payload back into an Error instance so messages
 * survive re-serialization without becoming "[object Object]".
 * @param serialized - Serialized error payload from persisted workflow state
 * @returns Rehydrated Error preserving message/name/stack when available
 */
export function deserializeError(serialized: Readonly<SerializedError>): Error {
  const error = new Error(serialized.message);
  if (serialized.name) {
    error.name = serialized.name;
  }
  if (serialized.stack) {
    error.stack = serialized.stack;
  }
  return error;
}

/**
 * Wrap an error with a clearer message while preserving the original cause.
 * @param message - The message to use for the new error
 * @param error - The original error
 * @returns A new error with the original error as its cause
 */
export function wrapError(message: string, error: unknown): Error {
  const { message: wrappedMessage } = serializeError(error);
  return new Error(`${message}: ${wrappedMessage}`, { cause: error });
}

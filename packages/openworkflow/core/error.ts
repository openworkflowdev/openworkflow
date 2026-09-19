import type { JsonValue } from "./json.js";

export interface SerializedError {
  name?: string;
  message: string;
  stack?: string;
  [key: string]: JsonValue;
}

/**
 * Serialize an error to a JSON-compatible format.
 * @param cause - The error to serialize (can be Error instance or any value)
 * @returns A JSON-serializable error object
 */
export function serializeError(cause: unknown): SerializedError {
  if (cause instanceof Error) {
    const { name, message, stack } = cause;

    if (stack) {
      return { name, message, stack };
    }

    return { name, message };
  }

  return {
    message: String(cause),
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
 * @param cause - The original error
 * @returns A new error with the original error as its cause
 */
export function wrapError(message: string, cause: unknown): Error {
  const { message: wrappedMessage } = serializeError(cause);
  return new Error(`${message}: ${wrappedMessage}`, { cause });
}

/**
 * Assert a backend mutation returned a row, throwing `Failed to ${operation}`
 * otherwise.
 * @param row - The row returned by the backend (or undefined/null if none matched)
 * @param operation - Suffix describing the attempted mutation
 * @throws {Error} When the row is null or undefined
 */
export function requireRow<T>(
  row: T,
  operation: string,
): asserts row is NonNullable<T> {
  if (!row) throw new Error(`Failed to ${operation}`);
}

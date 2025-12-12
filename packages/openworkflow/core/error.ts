import type { JsonValue } from "./json.js";

export interface SerializedError {
  name?: string;
  message: string;
  stack?: string;
  [key: string]: JsonValue;
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

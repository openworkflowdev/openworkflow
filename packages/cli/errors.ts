/* v8 ignore file -- @preserve */
import { consola } from "consola";

/**
 * User-facing CLI error.
 */
export class CLIError extends Error {
  readonly detail: string | undefined;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = "CLIError";
    this.detail = detail;
  }
}

/**
 * Wraps a CLI action / handler function with error handling that catches
 * CLIError, prints it to the console, then exits. Other errors are rethrown.
 * @param fn - Action handler
 * @returns Wrapped handler
 */
export function withErrorHandling<T extends unknown[]>(
  fn: (...args: T) => void | Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (error) {
      if (error instanceof CLIError) {
        consola.error(error.message);
        if (error.detail) consola.info(error.detail);
        // eslint-disable-next-line unicorn/no-process-exit
        process.exit(1);
      }
      throw error;
    }
  };
}

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
 * Finish writing CLI output before exiting, including when handles remain open.
 * @param code - Process exit code
 */
export async function exit(code: number): Promise<never> {
  await Promise.all(
    [process.stdout, process.stderr].map(
      (stream) =>
        new Promise<void>((resolve) => {
          stream.end(resolve);
        }),
    ),
  );
  // oxlint-disable-next-line unicorn/no-process-exit
  process.exit(code);
}

/**
 * Wraps a CLI action / handler function with error handling that catches
 * errors, prints them to the console, then exits.
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
        consola.error([error.message, error.detail].filter(Boolean).join("\n"));
        return exit(1);
      }
      const message = error instanceof Error ? error.message : String(error);
      consola.error(`Unexpected error: ${message}`);
      if (error instanceof Error && error.stack) {
        consola.debug(error.stack);
      }
      return exit(1);
    }
  };
}

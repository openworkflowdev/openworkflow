/**
 * Receives operational log output from OpenWorkflow, such as worker loop and
 * heartbeat errors. The method signatures match `console`, so `console` itself
 * is a valid logger, and structured loggers can be adapted with a thin wrapper.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * The default logger, which writes to the global `console`.
 */
export const consoleLogger: Logger = console;

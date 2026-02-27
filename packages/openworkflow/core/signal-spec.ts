/**
 * A typed descriptor for a named signal. The `Payload` generic is compile-time
 * only — only `name` exists at runtime.
 *
 * Create one with {@link defineSignalSpec} and use it on both sides of the
 * signal API to get end-to-end type safety:
 *
 * ```ts
 * const approvalSignal = defineSignalSpec<{ approved: boolean }>("approval");
 *
 * // Workflow:
 * const decision = await step.waitForSignal(approvalSignal);
 *
 * // Sender:
 * await handle.sendSignal(approvalSignal, { approved: true });
 * ```
 */
export interface SignalSpec<Payload> {
  /** The signal name matched between `step.waitForSignal` and `sendSignal`. */
  readonly name: string;
  /**
   * Phantom type carrier — does NOT exist at runtime.
   * Prevents structural collapse between different `SignalSpec` instantiations.
   * @internal
   */
  readonly __types?: { payload: Payload };
}

/**
 * Create a typed signal descriptor.
 * @param name - Signal name. Must match the name passed to both
 * `step.waitForSignal` and `sendSignal`.
 * @returns A `SignalSpec<Payload>` descriptor.
 * @example
 * ```ts
 * const approvalSignal = defineSignalSpec<{ approved: boolean; comment?: string }>(
 *   "approval-decision",
 * );
 * ```
 */
export function defineSignalSpec<Payload = unknown>(
  name: string,
): SignalSpec<Payload> {
  return { name };
}

/**
 * Extract the signal name from a `string` or `SignalSpec`.
 * @param nameOrSpec - Signal name string or `SignalSpec` descriptor.
 * @returns The signal name string.
 */
export function resolveSignalName(
  nameOrSpec: string | SignalSpec<unknown>,
): string {
  return typeof nameOrSpec === "string" ? nameOrSpec : nameOrSpec.name;
}

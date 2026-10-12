import type { JsonValue } from "./json.js";
import type { WorkflowSpec } from "./workflow-definition.js";
import { validateInput } from "./workflow-run.js";
import { CronExpressionParser, type CronExpression } from "cron-parser";

/** Options shared by startup declarations and runtime schedule registration. */
export interface WorkflowScheduleOptions {
  /** Defaults to the exact workflow name, within the backend namespace. */
  id?: string;
  /** Five cron fields, or six fields with leading seconds. */
  cron: string;
  /** IANA timezone; defaults to UTC. */
  timezone?: string;
}

/** Validated declaration persisted by the backend using last-write-wins. */
export interface WorkflowScheduleDefinition {
  id: string;
  workflowName: string;
  input: JsonValue | null;
  cron: string;
  timezone: string;
}

/** A recurring schedule and its current dispatch cursor. */
export interface WorkflowSchedule extends WorkflowScheduleDefinition {
  namespaceId: string;
  /** Null while paused. Resuming computes the next future occurrence. */
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Validate and transform input once, just as runWorkflow does.
 * @param spec - Target workflow
 * @param input - Unparsed workflow input
 * @param options - Replacement schedule declaration
 * @returns Validated, serializable declaration
 */
export async function prepareWorkflowSchedule<Input, Output, RunInput>(
  spec: WorkflowSpec<Input, Output, RunInput>,
  input: RunInput | undefined,
  options: WorkflowScheduleOptions,
): Promise<WorkflowScheduleDefinition> {
  if (spec.version !== undefined) {
    throw new Error("Recurring schedules require an unversioned workflow");
  }
  const id = options.id ?? spec.name;
  validateWorkflowScheduleId(id);
  const timezone = options.timezone ?? "UTC";
  const expression = parseSchedule(options.cron, timezone, new Date());
  // Also reject expressions with no possible future occurrence.
  expression.next();
  const result = await validateInput(spec.schema, input);
  if (!result.success) throw new Error(result.error);
  return {
    id,
    workflowName: spec.name,
    input: result.value ?? null,
    cron: expression.stringify(true),
    timezone,
  };
}

/**
 * Validate the public schedule ID for management operations.
 * @param id - ID within a backend namespace
 */
export function validateWorkflowScheduleId(id: string): void {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Validate untyped JavaScript callers too.
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("A schedule ID must be a nonempty string");
  }
}

/**
 * Find the next occurrence using cron-parser's timezone and DST behavior.
 * @param schedule - Cron and timezone
 * @param after - Exclusive lower bound
 * @returns Next occurrence strictly after the bound
 */
export function nextScheduleOccurrence(
  schedule: Pick<WorkflowScheduleDefinition, "cron" | "timezone">,
  after: Date,
): Date {
  return parseSchedule(schedule.cron, schedule.timezone, after).next().toDate();
}

/**
 * Validate cron and timezone and create an occurrence iterator.
 * @param cron - Five or six fields
 * @param timezone - IANA timezone
 * @param currentDate - Exclusive lower bound
 * @returns Cron iterator
 */
function parseSchedule(
  cron: string,
  timezone: string,
  currentDate: Date,
): CronExpression {
  if (
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Public schedule validation includes JavaScript inputs.
    typeof cron !== "string" ||
    ![5, 6].includes(cron.trim().split(/\s+/).length) ||
    /\bH\b/i.test(cron)
  ) {
    throw new Error(
      "Schedules require five or six cron fields without randomized values",
    );
  }
  if (
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Public schedule validation includes JavaScript inputs.
    typeof timezone !== "string"
  ) {
    throw new TypeError("Schedule timezone must be a string");
  }
  // Intl rejects host-dependent "local" and "system" zones.
  const resolvedTimezone = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
  }).resolvedOptions().timeZone;
  return CronExpressionParser.parse(cron, {
    tz: resolvedTimezone,
    currentDate,
  });
}

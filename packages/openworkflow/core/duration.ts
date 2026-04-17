import type { Result } from "./result.js";
import { ok, err } from "./result.js";

type Years = "years" | "year" | "yrs" | "yr" | "y";
type Months = "months" | "month" | "mo";
type Weeks = "weeks" | "week" | "w";
type Days = "days" | "day" | "d";
type Hours = "hours" | "hour" | "hrs" | "hr" | "h";
type Minutes = "minutes" | "minute" | "mins" | "min" | "m";
type Seconds = "seconds" | "second" | "secs" | "sec" | "s";
type Milliseconds = "milliseconds" | "millisecond" | "msecs" | "msec" | "ms";
type Unit =
  | Years
  | Months
  | Weeks
  | Days
  | Hours
  | Minutes
  | Seconds
  | Milliseconds;
type UnitAnyCase = Capitalize<Unit> | Uppercase<Unit> | Lowercase<Unit>;
export type DurationString =
  | `${number}`
  | `${number}${UnitAnyCase}`
  | `${number} ${UnitAnyCase}`;

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
// Average Gregorian month/year (365.25 days / 12) so month * 12 === year.
const MONTH_MS = 2_629_800_000;
const YEAR_MS = 31_557_600_000;

const DURATION_MULTIPLIERS = {
  millisecond: 1,
  milliseconds: 1,
  msec: 1,
  msecs: 1,
  ms: 1,
  second: SECOND_MS,
  seconds: SECOND_MS,
  sec: SECOND_MS,
  secs: SECOND_MS,
  s: SECOND_MS,
  minute: MINUTE_MS,
  minutes: MINUTE_MS,
  min: MINUTE_MS,
  mins: MINUTE_MS,
  m: MINUTE_MS,
  hour: HOUR_MS,
  hours: HOUR_MS,
  hr: HOUR_MS,
  hrs: HOUR_MS,
  h: HOUR_MS,
  day: DAY_MS,
  days: DAY_MS,
  d: DAY_MS,
  week: WEEK_MS,
  weeks: WEEK_MS,
  w: WEEK_MS,
  month: MONTH_MS,
  months: MONTH_MS,
  mo: MONTH_MS,
  year: YEAR_MS,
  years: YEAR_MS,
  yr: YEAR_MS,
  yrs: YEAR_MS,
  y: YEAR_MS,
} satisfies Record<Unit, number>;

const DURATION_REGEX = /^(-?\.?\d+(?:\.\d+)?)\s*([a-z]+)?$/i;

/**
 * Type guard narrowing an arbitrary string to a known duration unit.
 * @param value - Lowercased unit string from the parse regex
 * @returns True when the value is a known Unit
 */
function isDurationUnit(value: string): value is Unit {
  return value in DURATION_MULTIPLIERS;
}

/**
 * Parse a duration string into milliseconds. Examples:
 * - short units: "1ms", "5s", "30m", "2h", "7d", "3w", "1y"
 * - long units: "1 millisecond", "5 seconds", "30 minutes", "2 hours", "7 days", "3 weeks", "1 year"
 * @param str - Duration string
 * @returns Milliseconds
 */
export function parseDuration(str: DurationString): Result<number> {
  if (typeof str !== "string") {
    return err(
      new TypeError(
        "Invalid duration format: expected a string but received " + typeof str,
      ),
    );
  }

  if (str.length === 0) {
    return err(new Error('Invalid duration format: ""'));
  }

  const match = DURATION_REGEX.exec(str);

  if (!match?.[1]) {
    return err(new Error(`Invalid duration format: "${str}"`));
  }

  const numValue = Number.parseFloat(match[1]);
  const unit = match[2]?.toLowerCase() ?? "ms"; // default to ms if not provided

  if (!isDurationUnit(unit)) {
    return err(new Error(`Invalid duration format: "${str}"`));
  }

  return ok(numValue * DURATION_MULTIPLIERS[unit]);
}

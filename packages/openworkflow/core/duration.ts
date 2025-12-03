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

/**
 * Parse a duration string into milliseconds. Exmaples:
 * - short units: "1ms", "5s", "30m", "2h", "7d", "3w", "1y"
 * - long units: "1 millisecond", "5 seconds", "30 minutes", "2 hours", "7 days", "3 weeks", "1 year"
 */
export function parseDuration(str: DurationString): Result<number, Error> {
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

  const match = /^(-?\.?\d+(?:\.\d+)?)\s*([a-z]+)?$/i.exec(str);

  if (!match?.[1]) {
    return err(new Error(`Invalid duration format: "${str}"`));
  }

  const numValue = Number.parseFloat(match[1]);
  const unit = match[2]?.toLowerCase() ?? "ms"; // default to ms if not provided

  const multipliers: Record<string, number> = {
    millisecond: 1,
    milliseconds: 1,
    msec: 1,
    msecs: 1,
    ms: 1,
    second: 1000,
    seconds: 1000,
    sec: 1000,
    secs: 1000,
    s: 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,
    min: 60 * 1000,
    mins: 60 * 1000,
    m: 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hrs: 60 * 60 * 1000,
    h: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    month: 2_629_800_000,
    months: 2_629_800_000,
    mo: 2_629_800_000,
    year: 31_557_600_000,
    years: 31_557_600_000,
    yr: 31_557_600_000,
    yrs: 31_557_600_000,
    y: 31_557_600_000,
  };

  const multiplier = multipliers[unit];
  if (multiplier === undefined) {
    return err(new Error(`Invalid duration format: "${str}"`));
  }

  return ok(numValue * multiplier);
}

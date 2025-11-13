/**
 * Parse a duration string into milliseconds. Exmaples:
 * - short units: "1ms", "5s", "30m", "2h", "7d", "3w", "1y"
 * - long units: "1 millisecond", "5 seconds", "30 minutes", "2 hours", "7 days", "3 weeks", "1 year"
 */
export function parseDuration(duration: string): number {
  if (typeof duration !== "string") {
    throw new TypeError(
      "Invalid duration format: expected a string but received " +
        typeof duration,
    );
  }

  if (duration.length === 0) {
    throw new Error('Invalid duration format: ""');
  }

  const match = /^(-?\.?\d+(?:\.\d+)?)\s*([a-z]+)?$/i.exec(duration);

  if (!match?.[1]) {
    throw new Error(`Invalid duration format: "${duration}"`);
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
    throw new Error(`Invalid duration format: "${duration}"`);
  }

  return numValue * multiplier;
}

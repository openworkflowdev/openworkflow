/**
 * Parse a duration string like "1h", "30m", "5s" into milliseconds.
 * Supported units: d (days), h (hours), m (minutes), s (seconds), ms (milliseconds)
 */
export function parseDuration(duration: string): number {
  const regex = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/;
  const match = regex.exec(duration);
  if (!match?.[1] || !match[2]) {
    throw new Error(
      `Invalid duration format: "${duration}". Expected format: <number><unit> (e.g., "5s", "30m", "2h")`,
    );
  }

  const value = Number.parseFloat(match[1]);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  const multiplier = multipliers[unit];
  if (multiplier === undefined) {
    throw new Error(`Unknown duration unit: "${unit}"`);
  }

  return value * multiplier;
}

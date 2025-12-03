import { parseDuration } from "./duration.js";
import type { DurationString } from "./duration.js";
import { ok, err } from "./result.js";
import { describe, expect, test } from "vitest";

describe("parseDuration", () => {
  describe("milliseconds", () => {
    test("parses integer milliseconds", () => {
      expect(parseDuration("100ms")).toEqual(ok(100));
      expect(parseDuration("1ms")).toEqual(ok(1));
      expect(parseDuration("5000ms")).toEqual(ok(5000));
    });

    test("parses decimal milliseconds", () => {
      expect(parseDuration("1.5ms")).toEqual(ok(1.5));
      expect(parseDuration("10.25ms")).toEqual(ok(10.25));
    });

    test("parses milliseconds with long format", () => {
      expect(parseDuration("53 milliseconds")).toEqual(ok(53));
      expect(parseDuration("17 msecs")).toEqual(ok(17));
      expect(parseDuration("100 millisecond")).toEqual(ok(100));
    });

    test("parses numbers without unit as milliseconds", () => {
      expect(parseDuration("100")).toEqual(ok(100));
      expect(parseDuration("1000")).toEqual(ok(1000));
    });

    test("parses negative milliseconds", () => {
      expect(parseDuration("-100ms")).toEqual(ok(-100));
      expect(parseDuration("-100 milliseconds")).toEqual(ok(-100));
    });
  });

  describe("seconds", () => {
    test("parses integer seconds", () => {
      expect(parseDuration("1s")).toEqual(ok(1000));
      expect(parseDuration("5s")).toEqual(ok(5000));
      expect(parseDuration("60s")).toEqual(ok(60_000));
    });

    test("parses decimal seconds", () => {
      expect(parseDuration("1.5s")).toEqual(ok(1500));
      expect(parseDuration("0.1s")).toEqual(ok(100));
      expect(parseDuration("2.5s")).toEqual(ok(2500));
      expect(parseDuration("0.001s")).toEqual(ok(1));
    });

    test("parses seconds with long format", () => {
      expect(parseDuration("1 sec")).toEqual(ok(1000));
      expect(parseDuration("5 seconds")).toEqual(ok(5000));
      expect(parseDuration("10 secs")).toEqual(ok(10_000));
    });

    test("parses seconds with leading decimal", () => {
      expect(parseDuration(".5s")).toEqual(ok(500));
      expect(parseDuration(".5ms")).toEqual(ok(0.5));
    });

    test("parses negative seconds", () => {
      expect(parseDuration("-5s")).toEqual(ok(-5000));
      expect(parseDuration("-.5s")).toEqual(ok(-500));
    });
  });

  describe("minutes", () => {
    test("parses integer minutes", () => {
      expect(parseDuration("1m")).toEqual(ok(60 * 1000));
      expect(parseDuration("5m")).toEqual(ok(5 * 60 * 1000));
      expect(parseDuration("30m")).toEqual(ok(30 * 60 * 1000));
    });

    test("parses decimal minutes", () => {
      expect(parseDuration("1.5m")).toEqual(ok(1.5 * 60 * 1000));
      expect(parseDuration("0.5m")).toEqual(ok(30 * 1000));
    });

    test("parses minutes with long format", () => {
      expect(parseDuration("1 min")).toEqual(ok(60_000));
      expect(parseDuration("5 minutes")).toEqual(ok(5 * 60 * 1000));
      expect(parseDuration("10 mins")).toEqual(ok(10 * 60 * 1000));
    });
  });

  describe("hours", () => {
    test("parses integer hours", () => {
      expect(parseDuration("1h")).toEqual(ok(60 * 60 * 1000));
      expect(parseDuration("2h")).toEqual(ok(2 * 60 * 60 * 1000));
      expect(parseDuration("24h")).toEqual(ok(24 * 60 * 60 * 1000));
    });

    test("parses decimal hours", () => {
      expect(parseDuration("1.5h")).toEqual(ok(1.5 * 60 * 60 * 1000));
      expect(parseDuration("0.25h")).toEqual(ok(15 * 60 * 1000));
    });

    test("parses hours with long format", () => {
      expect(parseDuration("1 hr")).toEqual(ok(3_600_000));
      expect(parseDuration("2 hours")).toEqual(ok(2 * 60 * 60 * 1000));
      expect(parseDuration("3 hrs")).toEqual(ok(3 * 60 * 60 * 1000));
      expect(parseDuration("1.5 hours")).toEqual(ok(5_400_000));
    });

    test("parses negative hours", () => {
      expect(parseDuration("-1.5h")).toEqual(ok(-5_400_000));
      expect(parseDuration("-10.5h")).toEqual(ok(-37_800_000));
      expect(parseDuration("-.5h")).toEqual(ok(-1_800_000));
      expect(parseDuration("-1.5 hours")).toEqual(ok(-5_400_000));
      expect(parseDuration("-.5 hr")).toEqual(ok(-1_800_000));
    });
  });

  describe("days", () => {
    test("parses integer days", () => {
      expect(parseDuration("1d")).toEqual(ok(24 * 60 * 60 * 1000));
      expect(parseDuration("7d")).toEqual(ok(7 * 24 * 60 * 60 * 1000));
      expect(parseDuration("30d")).toEqual(ok(30 * 24 * 60 * 60 * 1000));
    });

    test("parses decimal days", () => {
      expect(parseDuration("1.5d")).toEqual(ok(1.5 * 24 * 60 * 60 * 1000));
      expect(parseDuration("0.5d")).toEqual(ok(12 * 60 * 60 * 1000));
    });

    test("parses days with long format", () => {
      expect(parseDuration("2 days")).toEqual(ok(172_800_000));
      expect(parseDuration("1 day")).toEqual(ok(24 * 60 * 60 * 1000));
    });
  });

  describe("weeks", () => {
    test("parses integer weeks", () => {
      expect(parseDuration("1w")).toEqual(ok(7 * 24 * 60 * 60 * 1000));
      expect(parseDuration("2w")).toEqual(ok(2 * 7 * 24 * 60 * 60 * 1000));
      expect(parseDuration("3w")).toEqual(ok(1_814_400_000));
    });

    test("parses decimal weeks", () => {
      expect(parseDuration("1.5w")).toEqual(ok(1.5 * 7 * 24 * 60 * 60 * 1000));
      expect(parseDuration("0.5w")).toEqual(ok(3.5 * 24 * 60 * 60 * 1000));
    });

    test("parses weeks with long format", () => {
      expect(parseDuration("1 week")).toEqual(ok(604_800_000));
      expect(parseDuration("2 weeks")).toEqual(ok(2 * 7 * 24 * 60 * 60 * 1000));
    });
  });

  describe("months", () => {
    test("parses integer months", () => {
      expect(parseDuration("1mo")).toEqual(ok(2_629_800_000));
      expect(parseDuration("2mo")).toEqual(ok(2 * 2_629_800_000));
      expect(parseDuration("6mo")).toEqual(ok(6 * 2_629_800_000));
    });

    test("parses decimal months", () => {
      expect(parseDuration("1.5mo")).toEqual(ok(1.5 * 2_629_800_000));
      expect(parseDuration("0.5mo")).toEqual(ok(0.5 * 2_629_800_000));
    });

    test("parses months with long format", () => {
      expect(parseDuration("1 month")).toEqual(ok(2_629_800_000));
      expect(parseDuration("2 months")).toEqual(ok(2 * 2_629_800_000));
    });
  });

  describe("years", () => {
    test("parses integer years", () => {
      expect(parseDuration("1y")).toEqual(ok(31_557_600_000));
      expect(parseDuration("2y")).toEqual(ok(2 * 31_557_600_000));
      expect(parseDuration("5y")).toEqual(ok(5 * 31_557_600_000));
    });

    test("parses decimal years", () => {
      expect(parseDuration("1.5y")).toEqual(ok(1.5 * 31_557_600_000));
      expect(parseDuration("0.5y")).toEqual(ok(0.5 * 31_557_600_000));
    });

    test("parses years with long format", () => {
      expect(parseDuration("1 year")).toEqual(ok(31_557_600_000));
      expect(parseDuration("2 years")).toEqual(ok(2 * 31_557_600_000));
      expect(parseDuration("1 yr")).toEqual(ok(31_557_600_000));
      expect(parseDuration("2 yrs")).toEqual(ok(2 * 31_557_600_000));
    });
  });

  describe("case insensitivity", () => {
    test("parses case-insensitive units", () => {
      expect(parseDuration("5S")).toEqual(ok(5000));
      expect(parseDuration("5M")).toEqual(ok(5 * 60 * 1000));
      expect(parseDuration("5H")).toEqual(ok(5 * 60 * 60 * 1000));
      expect(parseDuration("5D")).toEqual(ok(5 * 24 * 60 * 60 * 1000));
      expect(parseDuration("5W")).toEqual(ok(5 * 7 * 24 * 60 * 60 * 1000));
    });

    test("parses case-insensitive long format", () => {
      // @ts-expect-error - mixed-case (not in type but accepted at runtime)
      expect(parseDuration("53 YeArS")).toEqual(ok(1_672_552_800_000));
      // @ts-expect-error - mixed-case (not in type but accepted at runtime)
      expect(parseDuration("53 WeEkS")).toEqual(ok(32_054_400_000));
      // @ts-expect-error - mixed-case (not in type but accepted at runtime)
      expect(parseDuration("53 DaYS")).toEqual(ok(4_579_200_000));
      // @ts-expect-error - mixed-case (not in type but accepted at runtime)
      expect(parseDuration("53 HoUrs")).toEqual(ok(190_800_000));
      // @ts-expect-error - mixed-case (not in type but accepted at runtime)
      expect(parseDuration("53 MiLliSeCondS")).toEqual(ok(53));
    });
  });

  describe("whitespace handling", () => {
    test("parses with single space", () => {
      expect(parseDuration("1 s")).toEqual(ok(1000));
      expect(parseDuration("5 m")).toEqual(ok(5 * 60 * 1000));
      expect(parseDuration("2 h")).toEqual(ok(2 * 60 * 60 * 1000));
    });

    test("parses with multiple spaces", () => {
      expect(parseDuration("1   s")).toEqual(ok(1000));
      expect(parseDuration("5   m")).toEqual(ok(5 * 60 * 1000));
    });
  });

  describe("edge cases", () => {
    test("parses zero values", () => {
      expect(parseDuration("0ms")).toEqual(ok(0));
      expect(parseDuration("0s")).toEqual(ok(0));
      expect(parseDuration("0m")).toEqual(ok(0));
      expect(parseDuration("0h")).toEqual(ok(0));
      expect(parseDuration("0d")).toEqual(ok(0));
      expect(parseDuration("0")).toEqual(ok(0));
    });

    test("parses very small decimals", () => {
      expect(parseDuration("0.001s")).toEqual(ok(1));
      expect(parseDuration("0.1ms")).toEqual(ok(0.1));
    });

    test("parses large numbers", () => {
      expect(parseDuration("999999ms")).toEqual(ok(999_999));
      expect(parseDuration("1000s")).toEqual(ok(1_000_000));
    });
  });

  describe("error cases", () => {
    test("returns error on invalid format", () => {
      // @ts-expect-error - invalid format
      expect(parseDuration("invalid")).toEqual(
        err(new Error('Invalid duration format: "invalid"')),
      );
      // @ts-expect-error - invalid format
      expect(parseDuration("10-.5")).toEqual(
        err(new Error('Invalid duration format: "10-.5"')),
      );
      // @ts-expect-error - invalid format
      expect(parseDuration("foo")).toEqual(
        err(new Error('Invalid duration format: "foo"')),
      );
    });

    test("returns error on empty string", () => {
      // @ts-expect-error - empty string
      expect(parseDuration("")).toEqual(
        err(new Error('Invalid duration format: ""')),
      );
    });

    test("returns error on missing number", () => {
      // @ts-expect-error - unit without number
      expect(parseDuration("ms")).toEqual(
        err(new Error('Invalid duration format: "ms"')),
      );
      // @ts-expect-error - unit without number
      expect(parseDuration("s")).toEqual(
        err(new Error('Invalid duration format: "s"')),
      );
      // @ts-expect-error - unit without number
      expect(parseDuration("m")).toEqual(
        err(new Error('Invalid duration format: "m"')),
      );
      // @ts-expect-error - unit without number
      expect(parseDuration("h")).toEqual(
        err(new Error('Invalid duration format: "h"')),
      );
    });

    test("returns error on unknown unit", () => {
      // @ts-expect-error - unknown unit
      expect(parseDuration("100x")).toEqual(
        err(new Error('Invalid duration format: "100x"')),
      );
      // @ts-expect-error - unknown unit
      expect(parseDuration("5z")).toEqual(
        err(new Error('Invalid duration format: "5z"')),
      );
    });

    test("returns error on multiple units", () => {
      // @ts-expect-error - multiple units
      expect(parseDuration("1h30m")).toEqual(
        err(new Error('Invalid duration format: "1h30m"')),
      );
      // @ts-expect-error - multiple units
      expect(parseDuration("5s100ms")).toEqual(
        err(new Error('Invalid duration format: "5s100ms"')),
      );
    });

    test("returns error on leading/trailing spaces", () => {
      expect(parseDuration(" 5s")).toEqual(
        err(new Error('Invalid duration format: " 5s"')),
      );
      // @ts-expect-error - trailing space
      expect(parseDuration("5s ")).toEqual(
        err(new Error('Invalid duration format: "5s "')),
      );
    });

    test("returns error on special characters", () => {
      // @ts-expect-error - special characters
      expect(parseDuration("5s!")).toEqual(
        err(new Error('Invalid duration format: "5s!"')),
      );
      // @ts-expect-error - special characters
      expect(parseDuration("@5s")).toEqual(
        err(new Error('Invalid duration format: "@5s"')),
      );
    });

    test("returns error on non-string types", () => {
      expect(parseDuration(undefined as unknown as DurationString)).toEqual(
        err(
          new TypeError(
            "Invalid duration format: expected a string but received undefined",
          ),
        ),
      );
      expect(parseDuration(null as unknown as DurationString)).toEqual(
        err(
          new TypeError(
            "Invalid duration format: expected a string but received object",
          ),
        ),
      );
      expect(parseDuration([] as unknown as DurationString)).toEqual(
        err(
          new TypeError(
            "Invalid duration format: expected a string but received object",
          ),
        ),
      );
      expect(parseDuration({} as unknown as DurationString)).toEqual(
        err(
          new TypeError(
            "Invalid duration format: expected a string but received object",
          ),
        ),
      );
      expect(parseDuration(Number.NaN as unknown as DurationString)).toEqual(
        err(
          new TypeError(
            "Invalid duration format: expected a string but received number",
          ),
        ),
      );
      expect(
        parseDuration(Number.POSITIVE_INFINITY as unknown as DurationString),
      ).toEqual(
        err(
          new TypeError(
            "Invalid duration format: expected a string but received number",
          ),
        ),
      );
      expect(
        parseDuration(Number.NEGATIVE_INFINITY as unknown as DurationString),
      ).toEqual(
        err(
          new TypeError(
            "Invalid duration format: expected a string but received number",
          ),
        ),
      );
    });
  });
});

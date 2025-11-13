import { parseDuration } from "./duration.js";
import { describe, expect, test } from "vitest";

describe("parseDuration", () => {
  describe("milliseconds", () => {
    test("parses integer milliseconds", () => {
      expect(parseDuration("100ms")).toBe(100);
      expect(parseDuration("1ms")).toBe(1);
      expect(parseDuration("5000ms")).toBe(5000);
    });

    test("parses decimal milliseconds", () => {
      expect(parseDuration("1.5ms")).toBe(1.5);
      expect(parseDuration("10.25ms")).toBe(10.25);
    });

    test("parses milliseconds with long format", () => {
      expect(parseDuration("53 milliseconds")).toBe(53);
      expect(parseDuration("17 msecs")).toBe(17);
      expect(parseDuration("100 millisecond")).toBe(100);
    });

    test("parses numbers without unit as milliseconds", () => {
      expect(parseDuration("100")).toBe(100);
      expect(parseDuration("1000")).toBe(1000);
    });

    test("parses negative milliseconds", () => {
      expect(parseDuration("-100ms")).toBe(-100);
      expect(parseDuration("-100 milliseconds")).toBe(-100);
    });
  });

  describe("seconds", () => {
    test("parses integer seconds", () => {
      expect(parseDuration("1s")).toBe(1000);
      expect(parseDuration("5s")).toBe(5000);
      expect(parseDuration("60s")).toBe(60_000);
    });

    test("parses decimal seconds", () => {
      expect(parseDuration("1.5s")).toBe(1500);
      expect(parseDuration("0.1s")).toBe(100);
      expect(parseDuration("2.5s")).toBe(2500);
      expect(parseDuration("0.001s")).toBe(1);
    });

    test("parses seconds with long format", () => {
      expect(parseDuration("1 sec")).toBe(1000);
      expect(parseDuration("5 seconds")).toBe(5000);
      expect(parseDuration("10 secs")).toBe(10_000);
    });

    test("parses seconds with leading decimal", () => {
      expect(parseDuration(".5s")).toBe(500);
      expect(parseDuration(".5ms")).toBe(0.5);
    });

    test("parses negative seconds", () => {
      expect(parseDuration("-5s")).toBe(-5000);
      expect(parseDuration("-.5s")).toBe(-500);
    });
  });

  describe("minutes", () => {
    test("parses integer minutes", () => {
      expect(parseDuration("1m")).toBe(60 * 1000);
      expect(parseDuration("5m")).toBe(5 * 60 * 1000);
      expect(parseDuration("30m")).toBe(30 * 60 * 1000);
    });

    test("parses decimal minutes", () => {
      expect(parseDuration("1.5m")).toBe(1.5 * 60 * 1000);
      expect(parseDuration("0.5m")).toBe(30 * 1000);
    });

    test("parses minutes with long format", () => {
      expect(parseDuration("1 min")).toBe(60_000);
      expect(parseDuration("5 minutes")).toBe(5 * 60 * 1000);
      expect(parseDuration("10 mins")).toBe(10 * 60 * 1000);
    });
  });

  describe("hours", () => {
    test("parses integer hours", () => {
      expect(parseDuration("1h")).toBe(60 * 60 * 1000);
      expect(parseDuration("2h")).toBe(2 * 60 * 60 * 1000);
      expect(parseDuration("24h")).toBe(24 * 60 * 60 * 1000);
    });

    test("parses decimal hours", () => {
      expect(parseDuration("1.5h")).toBe(1.5 * 60 * 60 * 1000);
      expect(parseDuration("0.25h")).toBe(15 * 60 * 1000);
    });

    test("parses hours with long format", () => {
      expect(parseDuration("1 hr")).toBe(3_600_000);
      expect(parseDuration("2 hours")).toBe(2 * 60 * 60 * 1000);
      expect(parseDuration("3 hrs")).toBe(3 * 60 * 60 * 1000);
      expect(parseDuration("1.5 hours")).toBe(5_400_000);
    });

    test("parses negative hours", () => {
      expect(parseDuration("-1.5h")).toBe(-5_400_000);
      expect(parseDuration("-10.5h")).toBe(-37_800_000);
      expect(parseDuration("-.5h")).toBe(-1_800_000);
      expect(parseDuration("-1.5 hours")).toBe(-5_400_000);
      expect(parseDuration("-.5 hr")).toBe(-1_800_000);
    });
  });

  describe("days", () => {
    test("parses integer days", () => {
      expect(parseDuration("1d")).toBe(24 * 60 * 60 * 1000);
      expect(parseDuration("7d")).toBe(7 * 24 * 60 * 60 * 1000);
      expect(parseDuration("30d")).toBe(30 * 24 * 60 * 60 * 1000);
    });

    test("parses decimal days", () => {
      expect(parseDuration("1.5d")).toBe(1.5 * 24 * 60 * 60 * 1000);
      expect(parseDuration("0.5d")).toBe(12 * 60 * 60 * 1000);
    });

    test("parses days with long format", () => {
      expect(parseDuration("2 days")).toBe(172_800_000);
      expect(parseDuration("1 day")).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe("weeks", () => {
    test("parses integer weeks", () => {
      expect(parseDuration("1w")).toBe(7 * 24 * 60 * 60 * 1000);
      expect(parseDuration("2w")).toBe(2 * 7 * 24 * 60 * 60 * 1000);
      expect(parseDuration("3w")).toBe(1_814_400_000);
    });

    test("parses decimal weeks", () => {
      expect(parseDuration("1.5w")).toBe(1.5 * 7 * 24 * 60 * 60 * 1000);
      expect(parseDuration("0.5w")).toBe(3.5 * 24 * 60 * 60 * 1000);
    });

    test("parses weeks with long format", () => {
      expect(parseDuration("1 week")).toBe(604_800_000);
      expect(parseDuration("2 weeks")).toBe(2 * 7 * 24 * 60 * 60 * 1000);
    });
  });

  describe("months", () => {
    test("parses integer months", () => {
      expect(parseDuration("1mo")).toBe(2_629_800_000);
      expect(parseDuration("2mo")).toBe(2 * 2_629_800_000);
      expect(parseDuration("6mo")).toBe(6 * 2_629_800_000);
    });

    test("parses decimal months", () => {
      expect(parseDuration("1.5mo")).toBe(1.5 * 2_629_800_000);
      expect(parseDuration("0.5mo")).toBe(0.5 * 2_629_800_000);
    });

    test("parses months with long format", () => {
      expect(parseDuration("1 month")).toBe(2_629_800_000);
      expect(parseDuration("2 months")).toBe(2 * 2_629_800_000);
    });
  });

  describe("years", () => {
    test("parses integer years", () => {
      expect(parseDuration("1y")).toBe(31_557_600_000);
      expect(parseDuration("2y")).toBe(2 * 31_557_600_000);
      expect(parseDuration("5y")).toBe(5 * 31_557_600_000);
    });

    test("parses decimal years", () => {
      expect(parseDuration("1.5y")).toBe(1.5 * 31_557_600_000);
      expect(parseDuration("0.5y")).toBe(0.5 * 31_557_600_000);
    });

    test("parses years with long format", () => {
      expect(parseDuration("1 year")).toBe(31_557_600_000);
      expect(parseDuration("2 years")).toBe(2 * 31_557_600_000);
      expect(parseDuration("1 yr")).toBe(31_557_600_000);
      expect(parseDuration("2 yrs")).toBe(2 * 31_557_600_000);
    });
  });

  describe("case insensitivity", () => {
    test("parses case-insensitive units", () => {
      expect(parseDuration("5S")).toBe(5000);
      expect(parseDuration("5M")).toBe(5 * 60 * 1000);
      expect(parseDuration("5H")).toBe(5 * 60 * 60 * 1000);
      expect(parseDuration("5D")).toBe(5 * 24 * 60 * 60 * 1000);
      expect(parseDuration("5W")).toBe(5 * 7 * 24 * 60 * 60 * 1000);
    });

    test("parses case-insensitive long format", () => {
      expect(parseDuration("53 YeArS")).toBe(1_672_552_800_000);
      expect(parseDuration("53 WeEkS")).toBe(32_054_400_000);
      expect(parseDuration("53 DaYS")).toBe(4_579_200_000);
      expect(parseDuration("53 HoUrs")).toBe(190_800_000);
      expect(parseDuration("53 MiLliSeCondS")).toBe(53);
    });
  });

  describe("whitespace handling", () => {
    test("parses with single space", () => {
      expect(parseDuration("1 s")).toBe(1000);
      expect(parseDuration("5 m")).toBe(5 * 60 * 1000);
      expect(parseDuration("2 h")).toBe(2 * 60 * 60 * 1000);
    });

    test("parses with multiple spaces", () => {
      expect(parseDuration("1   s")).toBe(1000);
      expect(parseDuration("5   m")).toBe(5 * 60 * 1000);
    });
  });

  describe("edge cases", () => {
    test("parses zero values", () => {
      expect(parseDuration("0ms")).toBe(0);
      expect(parseDuration("0s")).toBe(0);
      expect(parseDuration("0m")).toBe(0);
      expect(parseDuration("0h")).toBe(0);
      expect(parseDuration("0d")).toBe(0);
      expect(parseDuration("0")).toBe(0);
    });

    test("parses very small decimals", () => {
      expect(parseDuration("0.001s")).toBe(1);
      expect(parseDuration("0.1ms")).toBe(0.1);
    });

    test("parses large numbers", () => {
      expect(parseDuration("999999ms")).toBe(999_999);
      expect(parseDuration("1000s")).toBe(1_000_000);
    });
  });

  describe("error cases", () => {
    test("throws on invalid format", () => {
      expect(() => parseDuration("invalid")).toThrow(
        'Invalid duration format: "invalid"',
      );
      expect(() => parseDuration("10-.5")).toThrow(
        'Invalid duration format: "10-.5"',
      );
      expect(() => parseDuration("foo")).toThrow(
        'Invalid duration format: "foo"',
      );
    });

    test("throws on empty string", () => {
      expect(() => parseDuration("")).toThrow('Invalid duration format: ""');
    });

    test("throws on missing number", () => {
      expect(() => parseDuration("ms")).toThrow(
        'Invalid duration format: "ms"',
      );
      expect(() => parseDuration("s")).toThrow('Invalid duration format: "s"');
      expect(() => parseDuration("m")).toThrow('Invalid duration format: "m"');
      expect(() => parseDuration("h")).toThrow('Invalid duration format: "h"');
    });

    test("throws on unknown unit", () => {
      expect(() => parseDuration("100x")).toThrow(
        'Invalid duration format: "100x"',
      );
      expect(() => parseDuration("5z")).toThrow(
        'Invalid duration format: "5z"',
      );
    });

    test("throws on multiple units", () => {
      expect(() => parseDuration("1h30m")).toThrow(
        'Invalid duration format: "1h30m"',
      );
      expect(() => parseDuration("5s100ms")).toThrow(
        'Invalid duration format: "5s100ms"',
      );
    });

    test("throws on leading/trailing spaces", () => {
      expect(() => parseDuration(" 5s")).toThrow(
        'Invalid duration format: " 5s"',
      );
      expect(() => parseDuration("5s ")).toThrow(
        'Invalid duration format: "5s "',
      );
    });

    test("throws on special characters", () => {
      expect(() => parseDuration("5s!")).toThrow(
        'Invalid duration format: "5s!"',
      );
      expect(() => parseDuration("@5s")).toThrow(
        'Invalid duration format: "@5s"',
      );
    });

    test("throws on non-string types", () => {
      expect(() => parseDuration(undefined as unknown as string)).toThrow(
        TypeError,
      );
      expect(() => parseDuration(null as unknown as string)).toThrow(TypeError);
      expect(() => parseDuration([] as unknown as string)).toThrow(TypeError);
      expect(() => parseDuration({} as unknown as string)).toThrow(TypeError);
      expect(() => parseDuration(Number.NaN as unknown as string)).toThrow(
        TypeError,
      );
      expect(() =>
        parseDuration(Number.POSITIVE_INFINITY as unknown as string),
      ).toThrow(TypeError);
      expect(() =>
        parseDuration(Number.NEGATIVE_INFINITY as unknown as string),
      ).toThrow(TypeError);
    });
  });
});

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
  });

  describe("edge cases", () => {
    test("parses zero values", () => {
      expect(parseDuration("0ms")).toBe(0);
      expect(parseDuration("0s")).toBe(0);
      expect(parseDuration("0m")).toBe(0);
      expect(parseDuration("0h")).toBe(0);
      expect(parseDuration("0d")).toBe(0);
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
      expect(() => parseDuration("")).toThrow('Invalid duration format: ""');
      expect(() => parseDuration("100")).toThrow(
        'Invalid duration format: "100"',
      );
    });

    test("throws on missing number", () => {
      expect(() => parseDuration("ms")).toThrow(
        'Invalid duration format: "ms"',
      );
      expect(() => parseDuration("s")).toThrow('Invalid duration format: "s"');
    });

    test("throws on missing unit", () => {
      expect(() => parseDuration("100")).toThrow(
        'Invalid duration format: "100"',
      );
    });

    test("throws on unknown unit", () => {
      expect(() => parseDuration("100x")).toThrow(
        'Invalid duration format: "100x"',
      );
      expect(() => parseDuration("5w")).toThrow(
        'Invalid duration format: "5w"',
      );
      expect(() => parseDuration("10y")).toThrow(
        'Invalid duration format: "10y"',
      );
    });

    test("throws on negative numbers", () => {
      expect(() => parseDuration("-5s")).toThrow(
        'Invalid duration format: "-5s"',
      );
      expect(() => parseDuration("-100ms")).toThrow(
        'Invalid duration format: "-100ms"',
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

    test("throws on spaces", () => {
      expect(() => parseDuration("5 s")).toThrow(
        'Invalid duration format: "5 s"',
      );
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
  });
});

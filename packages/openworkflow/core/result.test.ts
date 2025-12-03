import { ok, err } from "./result.js";
import { describe, expect, test } from "vitest";

describe("Result helpers", () => {
  test("ok creates success result", () => {
    expect(ok(123)).toEqual({ ok: true, value: 123 });
  });

  test("err creates error result", () => {
    expect(err("oops")).toEqual({ ok: false, error: "oops" });
  });
});

import type { JsonValue } from "./json.js";
import { getRerunStepIndices } from "./rerun.js";
import { describe, expect, test } from "vitest";

describe("getRerunStepIndices", () => {
  test.each<{ context: JsonValue }>([
    { context: null },
    { context: "legacy context" },
    { context: [] },
    { context: {} },
    { context: { rerunStepIndices: null } },
    { context: { rerunStepIndices: [0, 1] } },
    { context: { rerunStepIndices: "invalid" } },
  ])(
    "ignores absent or malformed step-order metadata: $context",
    ({ context }) => {
      expect(getRerunStepIndices(context)).toEqual(new Map());
    },
  );

  test("retains only nonnegative safe integer indices without changing the context", () => {
    const indices = {
      first: 0,
      later: 5,
      largest: Number.MAX_SAFE_INTEGER,
      negative: -1,
      fractional: 1.5,
      unsafe: Number.MAX_SAFE_INTEGER + 1,
      numericString: "2",
      missing: null,
      nested: { index: 3 },
    };
    const context = { rerunStepIndices: { ...indices } };
    const result = getRerunStepIndices(context);

    expect(result).toEqual(
      new Map([
        ["first", 0],
        ["later", 5],
        ["largest", Number.MAX_SAFE_INTEGER],
      ]),
    );
    result.set("first", 10);
    expect(context.rerunStepIndices).toEqual(indices);
  });
});

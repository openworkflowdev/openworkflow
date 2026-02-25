import { deserializeError, serializeError, wrapError } from "./error.js";
import { describe, expect, test } from "vitest";

describe("serializeError", () => {
  test("serializes Error instance with name, message, and stack", () => {
    const error = new Error("Something went wrong");
    const result = serializeError(error);

    expect(result.name).toBe("Error");
    expect(result.message).toBe("Something went wrong");
    expect(result.stack).toBeDefined();
    expect(typeof result.stack).toBe("string");
  });

  test("serializes TypeError with correct name", () => {
    const error = new TypeError("Invalid type");
    const result = serializeError(error);

    expect(result.name).toBe("TypeError");
    expect(result.message).toBe("Invalid type");
  });

  test("serializes custom Error subclass", () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomError";
      }
    }
    const error = new CustomError("Custom error message");
    const result = serializeError(error);

    expect(result.name).toBe("CustomError");
    expect(result.message).toBe("Custom error message");
  });

  test("serializes Error without stack as undefined", () => {
    const error = new Error("No stack");
    // @ts-expect-error testing edge case
    error.stack = undefined;
    const result = serializeError(error);

    expect(result.stack).toBeUndefined();
  });

  test("serializes string to message", () => {
    const result = serializeError("string error");

    expect(result.message).toBe("string error");
    expect(result.name).toBeUndefined();
    expect(result.stack).toBeUndefined();
  });

  test("serializes number to message", () => {
    const result = serializeError(42);

    expect(result.message).toBe("42");
  });

  test("serializes null to message", () => {
    const result = serializeError(null);

    expect(result.message).toBe("null");
  });

  test("serializes undefined to message", () => {
    // eslint-disable-next-line unicorn/no-useless-undefined
    const result = serializeError(undefined);

    expect(result.message).toBe("undefined");
  });

  test("serializes object to message using String()", () => {
    const result = serializeError({ foo: "bar" });

    expect(result.message).toBe("[object Object]");
  });
});

describe("wrapError", () => {
  test("wraps errors with serialized cause", () => {
    const original = new Error("boom");
    const wrapped = wrapError("Top-level", original);

    expect(original.message).toBe("boom");
    expect(wrapped.message).toBe("Top-level: boom");
    expect(wrapped.cause).toBe(original);
  });

  test("wraps string errors with serialized cause", () => {
    const wrapped = wrapError("Top-level", "boom");

    expect(wrapped.message).toBe("Top-level: boom");
    expect(wrapped.cause).toBe("boom");
  });
});

describe("deserializeError", () => {
  test("reconstructs Error with message", () => {
    const error = deserializeError({ message: "boom" });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("boom");
  });

  test("preserves name from serialized payload", () => {
    const error = deserializeError({ message: "fail", name: "TypeError" });

    expect(error.name).toBe("TypeError");
    expect(error.message).toBe("fail");
  });

  test("preserves stack from serialized payload", () => {
    const stack = "Error: fail\n    at test.ts:1:1";
    const error = deserializeError({ message: "fail", stack });

    expect(error.stack).toBe(stack);
  });

  test("roundtrips through serializeError", () => {
    const original = new TypeError("type mismatch");
    const serialized = serializeError(original);
    const restored = deserializeError(serialized);

    expect(restored.message).toBe(original.message);
    expect(restored.name).toBe(original.name);
  });
});

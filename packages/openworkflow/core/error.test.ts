import { serializeError } from "../core/error.js";
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

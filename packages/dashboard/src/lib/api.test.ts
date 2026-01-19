import { ErrorCode } from "./api";
import type { ApiError } from "./api";
import { describe, expect, test } from "vitest";

describe("API Error Handling", () => {
  describe("ApiError structure", () => {
    test("should have correct error codes", () => {
      expect(ErrorCode.DATABASE_CONNECTION_FAILED).toBe(
        "DATABASE_CONNECTION_FAILED",
      );
      expect(ErrorCode.BACKEND_INITIALIZATION_FAILED).toBe(
        "BACKEND_INITIALIZATION_FAILED",
      );
      expect(ErrorCode.NOT_FOUND).toBe("NOT_FOUND");
      expect(ErrorCode.INTERNAL_ERROR).toBe("INTERNAL_ERROR");
    });

    test("should be serializable to JSON", () => {
      const error: ApiError = {
        code: ErrorCode.DATABASE_CONNECTION_FAILED,
        message: "Database connection failed",
        details: "Connection refused on port 5432",
      };

      const serialized = JSON.stringify(error);
      const deserialized = JSON.parse(serialized) as ApiError;

      expect(deserialized.code).toBe(ErrorCode.DATABASE_CONNECTION_FAILED);
      expect(deserialized.message).toBe("Database connection failed");
      expect(deserialized.details).toBe("Connection refused on port 5432");
    });
  });

  describe("Error message parsing", () => {
    test("should parse structured error from JSON string", () => {
      const apiError: ApiError = {
        code: ErrorCode.DATABASE_CONNECTION_FAILED,
        message: "Database connection failed",
        details: "ECONNREFUSED",
      };

      const errorString = JSON.stringify(apiError);
      const parsed = JSON.parse(errorString) as ApiError;

      expect(parsed.code).toBe(ErrorCode.DATABASE_CONNECTION_FAILED);
      expect(parsed.message).toBe("Database connection failed");
    });

    test("should handle error without details", () => {
      const apiError: ApiError = {
        code: ErrorCode.NOT_FOUND,
        message: "Resource not found",
      };

      const errorString = JSON.stringify(apiError);
      const parsed = JSON.parse(errorString) as ApiError;

      expect(parsed.code).toBe(ErrorCode.NOT_FOUND);
      expect(parsed.message).toBe("Resource not found");
      expect(parsed.details).toBeUndefined();
    });
  });
});

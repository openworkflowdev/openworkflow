import { decodeCursor, encodeCursor, type Cursor } from "./cursor.js";
import { describe, expect, test } from "vitest";

describe("encodeCursor", () => {
  test("encodes a cursor to a base64 string", () => {
    const cursor: Cursor = {
      createdAt: new Date("2026-01-15T12:34:56.789Z"),
      id: "abc123",
    };
    const encoded = encodeCursor(cursor);
    expect(typeof encoded).toBe("string");
    expect(encoded).toBe(
      Buffer.from(
        JSON.stringify({
          createdAt: cursor.createdAt,
          id: cursor.id,
        }),
      ).toString("base64"),
    );
  });

  test("produces base64-decodable JSON", () => {
    const cursor: Cursor = {
      createdAt: new Date("2026-01-15T12:34:56.789Z"),
      id: "abc123",
    };
    const encoded = encodeCursor(cursor);
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as { createdAt: string; id: string };
    expect(parsed.createdAt).toBe("2026-01-15T12:34:56.789Z");
    expect(parsed.id).toBe("abc123");
  });

  test("is deterministic for the same input", () => {
    const cursor: Cursor = {
      createdAt: new Date("2026-01-15T12:34:56.789Z"),
      id: "abc123",
    };
    expect(encodeCursor(cursor)).toBe(encodeCursor(cursor));
  });

  test("produces different outputs for different ids", () => {
    const createdAt = new Date("2026-01-15T12:34:56.789Z");
    expect(encodeCursor({ createdAt, id: "a" })).not.toBe(
      encodeCursor({ createdAt, id: "b" }),
    );
  });

  test("produces different outputs for different timestamps", () => {
    const id = "abc123";
    expect(
      encodeCursor({ createdAt: new Date("2026-01-15T12:34:56.789Z"), id }),
    ).not.toBe(
      encodeCursor({ createdAt: new Date("2026-01-15T12:34:56.790Z"), id }),
    );
  });

  test("ignores extra fields via Readonly<Cursor> typing", () => {
    const cursor = {
      createdAt: new Date("2026-01-15T12:34:56.789Z"),
      id: "abc123",
      extra: "ignored",
    } as unknown as Cursor;
    const encoded = encodeCursor(cursor);
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    expect(parsed).toEqual({
      createdAt: "2026-01-15T12:34:56.789Z",
      id: "abc123",
    });
    expect(parsed["extra"]).toBeUndefined();
  });

  test("handles empty id", () => {
    const cursor: Cursor = {
      createdAt: new Date("2026-01-15T12:34:56.789Z"),
      id: "",
    };
    const encoded = encodeCursor(cursor);
    const decoded = decodeCursor(encoded);
    expect(decoded.id).toBe("");
  });

  test("handles ids with special characters", () => {
    const cursor: Cursor = {
      createdAt: new Date("2026-01-15T12:34:56.789Z"),
      id: 'weird/"\\id\n\t',
    };
    const encoded = encodeCursor(cursor);
    const decoded = decodeCursor(encoded);
    expect(decoded.id).toBe('weird/"\\id\n\t');
  });

  test("handles unicode ids", () => {
    const cursor: Cursor = {
      createdAt: new Date("2026-01-15T12:34:56.789Z"),
      id: "🚀-café-漢字",
    };
    const encoded = encodeCursor(cursor);
    const decoded = decodeCursor(encoded);
    expect(decoded.id).toBe("🚀-café-漢字");
  });
});

describe("decodeCursor", () => {
  test("decodes a base64-encoded cursor", () => {
    const original: Cursor = {
      createdAt: new Date("2026-01-15T12:34:56.789Z"),
      id: "abc123",
    };
    const encoded = encodeCursor(original);
    const decoded = decodeCursor(encoded);
    expect(decoded.createdAt).toBeInstanceOf(Date);
    expect(decoded.createdAt.getTime()).toBe(original.createdAt.getTime());
    expect(decoded.id).toBe(original.id);
  });

  test("returns a Date instance for createdAt", () => {
    const encoded = encodeCursor({
      createdAt: new Date("2026-01-15T12:34:56.789Z"),
      id: "abc123",
    });
    const decoded = decodeCursor(encoded);
    expect(decoded.createdAt).toBeInstanceOf(Date);
  });

  test("preserves millisecond precision", () => {
    const createdAt = new Date("2026-01-15T12:34:56.789Z");
    const encoded = encodeCursor({ createdAt, id: "abc123" });
    const decoded = decodeCursor(encoded);
    expect(decoded.createdAt.getMilliseconds()).toBe(789);
    expect(decoded.createdAt.toISOString()).toBe("2026-01-15T12:34:56.789Z");
  });

  test("throws on non-base64 input that produces invalid JSON", () => {
    expect(() => decodeCursor("not-valid-base64!!!")).toThrow();
  });

  test("throws on empty string", () => {
    expect(() => decodeCursor("")).toThrow();
  });

  test("throws on base64 of invalid JSON", () => {
    const encoded = Buffer.from("not json at all").toString("base64");
    expect(() => decodeCursor(encoded)).toThrow();
  });
});

describe("encodeCursor / decodeCursor round-trip", () => {
  test("round-trips arbitrary cursors", () => {
    const cases: Cursor[] = [
      { createdAt: new Date("2026-01-15T12:34:56.789Z"), id: "abc123" },
      { createdAt: new Date(0), id: "epoch" },
      { createdAt: new Date("1970-01-01T00:00:00.000Z"), id: "zero" },
      { createdAt: new Date("9999-12-31T23:59:59.999Z"), id: "far-future" },
      {
        createdAt: new Date("2026-01-15T12:34:56.789Z"),
        id: "00000000-0000-0000-0000-000000000000",
      },
    ];

    for (const original of cases) {
      const decoded = decodeCursor(encodeCursor(original));
      expect(decoded.createdAt.getTime()).toBe(original.createdAt.getTime());
      expect(decoded.id).toBe(original.id);
    }
  });
});

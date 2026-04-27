import {
  buildPaginatedResponse,
  decodeCursor,
  decodeListCursor,
  encodeCursor,
  type Cursor,
} from "./cursor.js";
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

describe("decodeListCursor", () => {
  const cursor: Cursor = {
    createdAt: new Date("2026-01-15T12:34:56.789Z"),
    id: "abc123",
  };

  test("returns null when neither after nor before is set", () => {
    expect(decodeListCursor({})).toBeNull();
  });

  test("decodes the after cursor when only after is set", () => {
    const decoded = decodeListCursor({ after: encodeCursor(cursor) });
    expect(decoded?.id).toBe(cursor.id);
    expect(decoded?.createdAt.getTime()).toBe(cursor.createdAt.getTime());
  });

  test("decodes the before cursor when only before is set", () => {
    const decoded = decodeListCursor({ before: encodeCursor(cursor) });
    expect(decoded?.id).toBe(cursor.id);
    expect(decoded?.createdAt.getTime()).toBe(cursor.createdAt.getTime());
  });

  test("throws when both after and before are set", () => {
    const afterCursor: Cursor = {
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
      id: "after",
    };
    const beforeCursor: Cursor = {
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      id: "before",
    };
    expect(() =>
      decodeListCursor({
        after: encodeCursor(afterCursor),
        before: encodeCursor(beforeCursor),
      }),
    ).toThrow("Cannot specify both 'after' and 'before' cursors");
  });

  test("ignores empty-string after and before", () => {
    expect(decodeListCursor({ after: "", before: "" })).toBeNull();
  });
});

/**
 * Build a fixture row satisfying Cursor with a distinguishing `value` so
 * pagination tests can make strict structural assertions.
 * @param i - Zero-based row index
 * @returns Fixture row
 */
function makeRow(i: number): Cursor & { value: number } {
  return {
    createdAt: new Date(
      `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    ),
    id: `row-${String(i)}`,
    value: i,
  };
}

describe("buildPaginatedResponse", () => {
  test("returns all rows when under the limit with no cursors", () => {
    const rows = [makeRow(0), makeRow(1)];
    const response = buildPaginatedResponse(rows, 10, false, false);
    expect(response.data).toEqual(rows);
    expect(response.pagination).toEqual({ next: null, prev: null });
  });

  test("trims the trailing overflow row and exposes a next cursor", () => {
    const rows = [makeRow(0), makeRow(1), makeRow(2)];
    const response = buildPaginatedResponse(rows, 2, false, false);
    expect(response.data).toEqual([makeRow(0), makeRow(1)]);
    expect(response.pagination.next).toBe(encodeCursor(makeRow(1)));
    expect(response.pagination.prev).toBeNull();
  });

  test("exposes a prev cursor when hasAfter but no overflow", () => {
    const rows = [makeRow(0), makeRow(1)];
    const response = buildPaginatedResponse(rows, 5, true, false);
    expect(response.data).toEqual(rows);
    expect(response.pagination.next).toBeNull();
    expect(response.pagination.prev).toBe(encodeCursor(makeRow(0)));
  });

  test("exposes both cursors on a middle page with overflow and hasAfter", () => {
    const rows = [makeRow(0), makeRow(1), makeRow(2)];
    const response = buildPaginatedResponse(rows, 2, true, false);
    expect(response.data).toEqual([makeRow(0), makeRow(1)]);
    expect(response.pagination.next).toBe(encodeCursor(makeRow(1)));
    expect(response.pagination.prev).toBe(encodeCursor(makeRow(0)));
  });

  test("reverses rows when hasBefore is true and always exposes next", () => {
    const rows = [makeRow(2), makeRow(1), makeRow(0)];
    const response = buildPaginatedResponse(rows, 5, false, true);
    expect(response.data).toEqual([makeRow(0), makeRow(1), makeRow(2)]);
    expect(response.pagination.next).toBe(encodeCursor(makeRow(2)));
    expect(response.pagination.prev).toBeNull();
  });

  test("drops leading overflow row and exposes prev when hasBefore overflows", () => {
    // Backends over-fetch `limit + 1` rows in reverse order so the extra row
    // lands at index 0 after reversing. Dropping it yields the page-sized
    // window, and the next-row's cursor becomes `prev` for a further jump back.
    const rows = [makeRow(3), makeRow(2), makeRow(1), makeRow(0)];
    const response = buildPaginatedResponse(rows, 3, false, true);
    expect(response.data).toEqual([makeRow(1), makeRow(2), makeRow(3)]);
    expect(response.pagination.next).toBe(encodeCursor(makeRow(3)));
    expect(response.pagination.prev).toBe(encodeCursor(makeRow(1)));
  });

  test("returns empty pagination cursors for an empty page", () => {
    const response = buildPaginatedResponse<Cursor>([], 10, false, false);
    expect(response.data).toEqual([]);
    expect(response.pagination).toEqual({ next: null, prev: null });
  });

  test("does not mutate the input rows array", () => {
    const rows = [makeRow(0), makeRow(1), makeRow(2)];
    const snapshot = [...rows];
    buildPaginatedResponse(rows, 5, false, true);
    expect(rows).toEqual(snapshot);
  });
});

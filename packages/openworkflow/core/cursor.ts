/**
 * Cursor used for pagination. Requires created_at and id fields. Because JS
 * Date does not natively support microsecond precision dates, created_at should
 * be stored with millisecond precision in paginated tables to avoid issues with
 * cursor comparisons.
 */
export interface Cursor {
  createdAt: Date;
  id: string;
}

/**
 * Encode a pagination cursor to a string.
 * @param item - Cursor data
 * @returns Encoded cursor
 */
export function encodeCursor(item: Readonly<Cursor>): string {
  return Buffer.from(
    JSON.stringify({ createdAt: item.createdAt, id: item.id }),
  ).toString("base64");
}

/**
 * Decode a pagination cursor from a string.
 * @param cursor - Encoded cursor
 * @returns Cursor data
 */
export function decodeCursor(cursor: string): Cursor {
  const decoded = Buffer.from(cursor, "base64").toString("utf8");
  const parsed = JSON.parse(decoded) as { createdAt: string; id: string };
  return {
    createdAt: new Date(parsed.createdAt),
    id: parsed.id,
  };
}

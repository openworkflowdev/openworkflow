import type { PaginatedResponse } from "./backend.js";

/**
 * Default page size applied when a pagination request omits `limit`.
 */
export const DEFAULT_PAGINATION_PAGE_SIZE = 100;

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

/**
 * Decode the active cursor from list pagination params. Prefers `after` when
 * both are present, matching how backends build their queries.
 * @param params - Pagination params
 * @returns Decoded cursor, or null when neither side is set
 */
export function decodeListCursor(
  params: Readonly<{ after?: string; before?: string }>,
): Cursor | null {
  if (params.after) return decodeCursor(params.after);
  if (params.before) return decodeCursor(params.before);
  return null;
}

/**
 * Assemble a {@link PaginatedResponse} from an over-fetched row batch. Backends
 * query `limit + 1` rows to determine whether a next/previous page exists, and
 * this helper encapsulates the trim-and-reverse logic that decision requires.
 *
 * When `hasBefore` is true, the rows arrive in reverse order (ASC instead of
 * the forward query's DESC), so the response is reversed and the leading extra
 * row (if any) signals a previous page. Otherwise the trailing extra row (if
 * any) signals a next page.
 * @param rows - Rows fetched from the database (may exceed `limit` by one)
 * @param limit - The caller-facing page size
 * @param hasAfter - Whether the caller supplied an `after` cursor
 * @param hasBefore - Whether the caller supplied a `before` cursor
 * @returns Paginated response with next/prev cursors
 */
export function buildPaginatedResponse<T extends Cursor>(
  rows: readonly T[],
  limit: number,
  hasAfter: boolean,
  hasBefore: boolean,
): PaginatedResponse<T> {
  const overflow = rows.length > limit;
  const ordered = hasBefore ? rows.toReversed() : [...rows];
  const data = trimOverflow(ordered, overflow, hasBefore);

  const hasNext = hasBefore || overflow;
  const hasPrev = hasBefore ? overflow : hasAfter;

  const lastItem = data.at(-1);
  const firstItem = data[0];

  return {
    data,
    pagination: {
      next: hasNext && lastItem ? encodeCursor(lastItem) : null,
      prev: hasPrev && firstItem ? encodeCursor(firstItem) : null,
    },
  };
}

/**
 * Drop the extra over-fetched row from the leading or trailing edge, leaving
 * the page-sized window that callers should see.
 * @param rows - Oriented rows (reversed when `hasBefore` is true)
 * @param overflow - Whether the caller received more rows than the page size
 * @param hasBefore - Whether the caller supplied a `before` cursor
 * @returns Rows trimmed to the page size
 */
function trimOverflow<T>(
  rows: readonly T[],
  overflow: boolean,
  hasBefore: boolean,
): T[] {
  if (!overflow) return [...rows];
  return hasBefore ? rows.slice(1) : rows.slice(0, -1);
}

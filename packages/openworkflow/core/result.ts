export type Result<T, E> = Ok<T> | Err<E>;

export interface Ok<T> {
  ok: true;
  value: T;
}

export interface Err<E> {
  ok: false;
  error: E;
}

/**
 * Create an Ok result.
 * @param value - Result value
 * @returns Ok result
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/**
 * Create an Err result.
 * @param error - Result error
 * @returns Err result
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

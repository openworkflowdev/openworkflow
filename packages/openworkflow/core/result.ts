export type Result<T> = Ok<T> | Err;

export interface Ok<T> {
  ok: true;
  value: T;
}

export interface Err {
  ok: false;
  error: Error;
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
export function err(error: Readonly<Error>): Err {
  return { ok: false, error };
}

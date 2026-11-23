/**
 * Narrowing helpers for `catch (e)` bindings, which are `unknown` under
 * `useUnknownInCatchVariables`. Each one reads a conventional field of a thrown
 * value (Error subclasses, HttpError, PostgreSQL and Node system errors) and
 * yields `undefined` when the value does not carry it, so a call site keeps the
 * `|| fallback` and `?? fallback` behavior it already had.
 */

/**
 * Whether a thrown value is an object and can therefore carry fields such as
 * `message`, `code` or `statusCode`.
 * @param {unknown} e
 * @returns {e is Record<string, unknown>}
 */
export function isErrorLike(e) {
  return typeof e === "object" && e !== null;
}

/**
 * The thrown value's `message`, when it is a string.
 * @param {unknown} e
 * @returns {string | undefined}
 */
export function errorMessage(e) {
  return isErrorLike(e) && typeof e.message === "string" ? e.message : undefined;
}

/**
 * The thrown value's `code` (stable API code, PostgreSQL SQLSTATE or Node
 * system code), when it is a string.
 * @param {unknown} e
 * @returns {string | undefined}
 */
export function errorCode(e) {
  return isErrorLike(e) && typeof e.code === "string" ? e.code : undefined;
}

/**
 * The HTTP status an `HttpError`-style value carries as `statusCode`, when it
 * is a number.
 * @param {unknown} e
 * @returns {number | undefined}
 */
export function errorStatus(e) {
  return isErrorLike(e) && typeof e.statusCode === "number" ? e.statusCode : undefined;
}

/**
 * The thrown value as an `Error`: the value itself when it already is one,
 * otherwise a new `Error` whose message is the value's string form.
 * @param {unknown} e
 * @returns {Error}
 */
export function asError(e) {
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * The part of an Express response a middleware needs to answer with a JSON
 * body. Express's `Response` satisfies it (`status()` returns the response), and
 * so do the plain `{ status() { return this; }, json() {} }` objects the unit
 * tests pass, which is why middleware declares this view instead of `Response`.
 */
export interface JsonResponder {
  status(code: number): JsonResponder;
  json(body: unknown): unknown;
}

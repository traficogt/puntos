const PROBE_PATHS = new Set(
  ["/health", "/ready", "/live", "/metrics", "/info"].flatMap((path) => [path, `/v1${path}`]),
);

/** @param {string} path a request path relative to the /api mount */
export function isProbePath(path) {
  return PROBE_PATHS.has(String(path));
}

// Bound validation work as well as bytes. In particular, Zod 3 validates every
// array item before reporting .max() failures. Reject excessive structure first.
/**
 * @param {{ body?: unknown }} req only the parsed body is inspected
 * @param {import("../types/http.js").JsonResponder} res
 * @param {import("express").NextFunction} next
 */
export function requestComplexityLimit(req, res, next) {
  /** @type {Array<{ value: unknown, depth: number }>} */
  const pending = [{ value: req.body, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const next = pending.pop();
    if (!next) break;
    const { value, depth } = next;
    if (++nodes > 5000 || depth > 24)
      return res.status(413).json({ error: "El contenido de la solicitud es demasiado complejo." });
    if (value && typeof value === "object") {
      const entries = Object.values(value);
      if (entries.length + pending.length + nodes > 5000)
        return res.status(413).json({ error: "El contenido de la solicitud es demasiado grande." });
      for (const child of entries) pending.push({ value: child, depth: depth + 1 });
    }
  }
  return next();
}

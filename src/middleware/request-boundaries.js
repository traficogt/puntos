const PROBE_PATHS = new Set(["/health", "/ready", "/live", "/metrics", "/info"].flatMap((path) => [path, `/v1${path}`]));

export function isProbePath(path) {
  return PROBE_PATHS.has(String(path));
}

// Bound validation work as well as bytes. In particular, Zod 3 validates every
// array item before reporting .max() failures. Reject excessive structure first.
export function requestComplexityLimit(req, res, next) {
  const pending = [{ value: req.body, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const { value, depth } = pending.pop();
    if (++nodes > 5000 || depth > 24) return res.status(413).json({ error: "El contenido de la solicitud es demasiado complejo." });
    if (value && typeof value === "object") {
      const entries = Object.values(value);
      if (entries.length + pending.length + nodes > 5000) return res.status(413).json({ error: "El contenido de la solicitud es demasiado grande." });
      for (const child of entries) pending.push({ value: child, depth: depth + 1 });
    }
  }
  next();
}

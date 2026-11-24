// Historical SQL is immutable. Explicit prerequisites repair same-day filename
// ordering for fresh installations without changing already applied checksums.
/** @type {Record<string, readonly string[]>} migration file -> files it must follow */
const prerequisites = {
  "2026-11-10-mobile-access.sql": [
    "2026-02-27-tenant-rls_canonical.sql",
    "2026-03-19-auth-sessions.sql",
    "2026-03-19-security-notification-rls.sql",
  ],
  "2026-11-10-mobile-push.sql": ["2026-03-19-auth-sessions.sql"],
  "2026-03-08-ledger-balance-adjustments.sql": ["2026-03-08-ledger-corrections.sql"],
  "2026-03-08-ledger-corrections.sql": ["2026-03-08-ledger-reconciliation.sql"],
  "2026-03-19-account-security.sql": ["2026-03-19-auth-sessions.sql"],
  "2026-03-19-auth-session-mutations.sql": ["2026-03-19-auth-sessions.sql"],
};

/**
 * Sorts migration file names so every prerequisite runs before its dependents;
 * otherwise plain lexical (date) order.
 * @param {Iterable<string>} files
 * @returns {string[]}
 */
export function orderMigrations(files) {
  const available = new Set(files),
    /** @type {Set<string>} */
    visited = new Set(),
    /** @type {Set<string>} */
    visiting = new Set(),
    /** @type {string[]} */
    ordered = [];
  /** @param {string} file */
  function visit(file) {
    if (visited.has(file)) return;
    if (visiting.has(file)) throw new Error(`Cyclic migration dependency: ${file}`);
    if (!available.has(file)) throw new Error(`Missing migration dependency: ${file}`);
    visiting.add(file);
    for (const dependency of prerequisites[file] ?? []) visit(dependency);
    visiting.delete(file);
    visited.add(file);
    ordered.push(file);
  }
  for (const file of [...files].sort()) visit(file);
  return ordered;
}

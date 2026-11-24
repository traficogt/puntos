import { BranchRepo } from "../../repositories/branch-repository.js";

/**
 * Reads the optional `branch_id` filter (validated query first, raw query as a
 * fallback) and checks that the branch belongs to the tenant. Returns the id,
 * `null` when absent, or `"__invalid__"` after writing the 400 response.
 * @param {import("../_request-types.js").Request & { validatedQuery?: { branch_id?: unknown } }} req
 * @param {import("../_request-types.js").Response} res
 */
export async function resolveBranchFilter(req, res) {
  const branchId = req.validatedQuery?.branch_id
    ? String(req.validatedQuery.branch_id)
    : req.query.branch_id
      ? String(req.query.branch_id)
      : null;
  if (!branchId) return null;
  const branch = await BranchRepo.getById(branchId);
  if (!branch || branch.business_id !== req.tenantId) {
    res.status(400).json({ error: "branch_id no válido" });
    return "__invalid__";
  }
  return branchId;
}

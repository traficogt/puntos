import { BranchRepo } from "../../repositories/branch-repository.js";

export async function resolveBranchFilter(req, res) {
  const branchId = req.validatedQuery?.branch_id
    ? String(req.validatedQuery.branch_id)
    : (req.query.branch_id ? String(req.query.branch_id) : null);
  if (!branchId) return null;
  const branch = await BranchRepo.getById(branchId);
  if (!branch || branch.business_id !== req.tenantId) {
    res.status(400).json({ error: "Invalid branch_id" });
    return "__invalid__";
  }
  return branchId;
}

export const Role = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  CASHIER: "CASHIER",
};

export const Permission = {
  STAFF_AWARD: "staff.award",
  STAFF_REDEEM: "staff.redeem",
  STAFF_SYNC: "staff.sync",
  STAFF_REFUND: "staff.refund",
  ADMIN_PROGRAM_UPDATE_BASIC: "admin.program.update.basic",
  ADMIN_PROGRAM_UPDATE_ADVANCED: "admin.program.update.advanced",
  ADMIN_SUSPICIOUS_VIEW: "admin.suspicious.view",
};

/** @type {Record<string, ReadonlySet<string>>} role -> granted permissions */
const matrix = {
  [Role.OWNER]: new Set([
    Permission.STAFF_AWARD,
    Permission.STAFF_REDEEM,
    Permission.STAFF_SYNC,
    Permission.STAFF_REFUND,
    Permission.ADMIN_PROGRAM_UPDATE_BASIC,
    Permission.ADMIN_SUSPICIOUS_VIEW,
  ]),
  [Role.MANAGER]: new Set([
    Permission.STAFF_AWARD,
    Permission.STAFF_REDEEM,
    Permission.STAFF_SYNC,
    Permission.STAFF_REFUND,
    Permission.ADMIN_SUSPICIOUS_VIEW,
  ]),
  [Role.CASHIER]: new Set([Permission.STAFF_AWARD, Permission.STAFF_REDEEM, Permission.STAFF_SYNC]),
};

/**
 * @param {string} role a Role value (unknown roles have no permissions)
 * @param {string} permission a Permission value
 */
export function hasPermission(role, permission) {
  return matrix[role]?.has(permission) ?? false;
}

export function getPermissionMatrix() {
  return Object.fromEntries(Object.entries(matrix).map(([role, perms]) => [role, [...perms]]));
}

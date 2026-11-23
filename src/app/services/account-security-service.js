// Account security for staff and the super admin: password resets, e-mail
// changes, MFA enrollment/verification and account lockdown. The implementation
// lives in ./account-security/* by concern; this module is the public surface.
export {
  requestStaffPasswordReset,
  completeStaffPasswordReset,
  requestSuperPasswordReset,
  completeSuperPasswordReset,
} from "./account-security/password-reset.js";
export {
  requestStaffEmailChange,
  confirmStaffEmailChange,
  requestSuperEmailChange,
  confirmSuperEmailChange,
} from "./account-security/email-change.js";
export {
  pruneExpiredMfaCounters,
  startStaffMfaEnrollment,
  confirmStaffMfaEnrollment,
  disableStaffMfa,
  startSuperMfaEnrollment,
  confirmSuperMfaEnrollment,
  disableSuperMfa,
  verifyStaffMfaForLogin,
  verifySuperMfaForLogin,
  reauthenticateStaffSession,
  reauthenticateSuperSession,
} from "./account-security/mfa.js";
export { lockdownStaffAccount, lockdownSuperAccount } from "./account-security/lockdown.js";

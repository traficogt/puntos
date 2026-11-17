-- Last accepted TOTP time step per account. Login, re-authentication and MFA
-- enrollment accept a code only for a later step, recorded atomically, so a
-- code observed once cannot be replayed within its clock-skew window.
-- Additive and nullable: existing accounts start with no recorded step.
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS mfa_last_totp_step BIGINT;
ALTER TABLE super_admin_auth_settings ADD COLUMN IF NOT EXISTS mfa_last_totp_step BIGINT;

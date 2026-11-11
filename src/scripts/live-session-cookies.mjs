const staffSessionCookies = new Set(["pf_staff", "__Host-pf_staff", "pf_csrf", "pf_csrf_readable"]);

/** @param {Map<string, string>} source @param {Map<string, string>} target */
export function copyStaffSessionCookies(source, target) {
  for (const [name, value] of source) {
    if (staffSessionCookies.has(name)) target.set(name, value);
  }
}

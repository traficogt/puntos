import { execFileSync } from "node:child_process";

export function resolveJoinCode({ requestCodeData, businessSlug, phone }) {
  const direct = String(requestCodeData?.dev_code || "").trim();
  if (direct) return direct;

  let output = "";
  try {
    output = execFileSync("docker", [
      "compose",
      "exec",
      "-T",
      "api",
      "node",
      "src/scripts/dev-issue-join-code.mjs",
      "--slug",
      String(businessSlug),
      "--phone",
      String(phone)
    ], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8"
    });
  } catch {
    output = execFileSync("node", [
      "src/scripts/dev-issue-join-code.mjs",
      "--slug",
      String(businessSlug),
      "--phone",
      String(phone)
    ], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8"
    });
  }

  const parsed = JSON.parse(String(output || "{}"));
  const code = String(parsed?.code || "").trim();
  if (!code) {
    throw new Error("Failed to resolve dev join code");
  }
  return code;
}

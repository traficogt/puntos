export function getRequestIp(req) {
  const ip = typeof req?.ip === "string" ? req.ip.trim() : "";
  return ip || null;
}

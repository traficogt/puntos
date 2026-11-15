// APNs tokens are hexadecimal bytes. Keep registration and delivery bounds equal
// so accepted tokens never become permanently undeliverable stored work.
export function isApplePushToken(value) {
  return typeof value === 'string' && /^[a-fA-F0-9]{32,1024}$/.test(value) && value.length % 2 === 0;
}

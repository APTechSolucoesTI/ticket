/** Validate raw Storage keys before using a privileged signer or downloader. */
export function isTenantStoragePath(path: unknown, tenantId: string): path is string {
  if (typeof path !== "string" || /[%\\?#\u0000-\u001f\u007f]/.test(path)) return false;
  const segments = path.split("/");
  return (
    segments.length >= 3 &&
    segments[0] === tenantId &&
    segments.every(segment => segment !== "" && segment !== "." && segment !== "..")
  );
}

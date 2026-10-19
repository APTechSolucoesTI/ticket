/** Validate raw Storage keys before using a privileged signer or downloader. */
export function isTenantStoragePath(path: unknown, tenantId: string): path is string {
  if (typeof path !== "string" || /[%\\?#]/.test(path)) return false;
  if (
    [...path].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  ) {
    return false;
  }
  const segments = path.split("/");
  return (
    segments.length >= 3 &&
    segments[0] === tenantId &&
    segments.every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

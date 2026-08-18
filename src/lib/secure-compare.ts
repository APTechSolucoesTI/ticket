import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison. Prevents timing attacks on secret/token
 * checks (e.g. webhook signatures, static bearer secrets) by comparing
 * fixed-length SHA-256 digests instead of the raw strings.
 */
export function secureEquals(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

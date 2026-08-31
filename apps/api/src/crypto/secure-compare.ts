import { createHash, timingSafeEqual } from 'node:crypto';

/** Portado de apps/web/src/lib/secure-compare.ts - comparação em tempo constante. */
export function secureEquals(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

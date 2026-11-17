// INCR and expiry must execute in one Redis operation. Repair counters created
// by older releases without extending a window that already has an expiry.
export const FIXED_WINDOW_RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export function validateRateLimit(limit: number, windowSeconds: number): void {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    !Number.isSafeInteger(windowSeconds) ||
    windowSeconds < 1 ||
    windowSeconds > 2147483647
  ) {
    throw new RangeError('rate_limit_configuration_invalid');
  }
}

export function rateLimitResult(
  value: unknown,
  limit: number,
): { allowed: boolean; retryAfterSeconds: number } {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !Number.isSafeInteger(value[0]) ||
    value[0] < 1 ||
    !Number.isSafeInteger(value[1]) ||
    value[1] < 0
  ) {
    throw new Error('rate_limit_response_invalid');
  }
  const allowed = (value[0] as number) <= limit;
  return {
    allowed,
    retryAfterSeconds: allowed ? 0 : Math.max(1, value[1] as number),
  };
}

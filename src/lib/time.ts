/**
 * Deterministic clock.
 *
 * When TEST_MODE=1, a request may carry `x-test-now-ms: <ms since epoch>` and
 * that value is used as "now" for expiry logic. Outside TEST_MODE, or when the
 * header is absent or unparseable, the real system clock is used.
 */
export function resolveNow(headers: Headers): Date {
  if (process.env.TEST_MODE === '1') {
    const raw = headers.get('x-test-now-ms');
    if (raw !== null && raw.trim() !== '') {
      const ms = Number(raw.trim());
      if (Number.isSafeInteger(ms)) return new Date(ms);
    }
  }
  return new Date();
}

/** Postgres timestamptz tops out well above this; clamp to stay a valid Date. */
const MAX_EPOCH_MS = Date.UTC(9999, 0, 1);

/** `now` + ttl seconds, clamped so an absurd TTL cannot produce an invalid date. */
export function addSeconds(now: Date, seconds: number): Date {
  const ms = now.getTime() + seconds * 1000;
  return new Date(Math.min(ms, MAX_EPOCH_MS));
}

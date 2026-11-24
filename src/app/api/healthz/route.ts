import { pingDb } from '@/lib/db';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

const PING_TIMEOUT_MS = 2_000;

/**
 * GET /api/healthz
 *
 * Always HTTP 200 with JSON, as required by the spec, and the body reflects
 * whether the persistence layer is reachable. The ping is bounded so an
 * unreachable database cannot make the health check hang.
 */
export async function GET() {
  const startedAt = Date.now();
  let databaseOk = false;

  try {
    await Promise.race([
      pingDb(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('database ping timed out')), PING_TIMEOUT_MS),
      ),
    ]);
    databaseOk = true;
  } catch {
    databaseOk = false;
  }

  return json({
    ok: databaseOk,
    database: databaseOk ? 'up' : 'down',
    latency_ms: Date.now() - startedAt,
  });
}

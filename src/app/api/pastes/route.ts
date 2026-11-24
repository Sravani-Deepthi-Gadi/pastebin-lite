import { createPaste } from '@/lib/pastes';
import { baseUrl, errorJson, json } from '@/lib/http';
import { resolveNow } from '@/lib/time';
import { parseCreateInput } from '@/lib/validate';

export const dynamic = 'force-dynamic';

/**
 * POST /api/pastes
 *
 * Body: { content: string, ttl_seconds?: int >= 1, max_views?: int >= 1 }
 * 201:  { id, url, expires_at, max_views }
 * 400:  { error, message }
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson('invalid_json', 'Request body must be valid JSON', 400);
  }

  const parsed = parseCreateInput(body);
  if (!parsed.ok) {
    return errorJson(parsed.error, parsed.message, 400);
  }

  const now = resolveNow(request.headers);

  try {
    const { id, expiresAt } = await createPaste(parsed.value, now);
    return json(
      {
        id,
        url: `${baseUrl(request)}/p/${id}`,
        expires_at: expiresAt === null ? null : expiresAt.toISOString(),
        max_views: parsed.value.maxViews,
      },
      201,
    );
  } catch (error) {
    console.error('failed to create paste', error);
    return errorJson('storage_unavailable', 'Could not store the paste', 503);
  }
}

/** Anything other than POST on this collection. */
export async function GET() {
  return errorJson('method_not_allowed', 'Use POST to create a paste', 405);
}

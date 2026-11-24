import { consumePaste } from '@/lib/pastes';
import { errorJson, json, notFoundJson } from '@/lib/http';
import { resolveNow } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * GET /api/pastes/:id
 *
 * A successful fetch counts as one view.
 * 200: { content, remaining_views, expires_at }
 * 404: { error, message } for a missing, expired or exhausted paste.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const now = resolveNow(request.headers);

  try {
    const paste = await consumePaste(id, now);
    if (!paste) return notFoundJson();

    return json({
      content: paste.content,
      remaining_views: paste.remainingViews,
      expires_at: paste.expiresAt === null ? null : paste.expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('failed to read paste', error);
    return errorJson('storage_unavailable', 'Could not read the paste', 503);
  }
}

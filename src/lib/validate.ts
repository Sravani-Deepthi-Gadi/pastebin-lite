/** Request-body validation for paste creation. */

export const MAX_CONTENT_BYTES = 512 * 1024;

export interface CreateInput {
  content: string;
  ttlSeconds: number | null;
  maxViews: number | null;
}

export type ValidationResult =
  | { ok: true; value: CreateInput }
  | { ok: false; error: string; message: string };

function invalid(error: string, message: string): ValidationResult {
  return { ok: false, error, message };
}

/**
 * Optional positive integer. `undefined` and `null` both mean "no constraint";
 * anything else must be an integer >= 1.
 */
function parseOptionalPositiveInt(
  value: unknown,
  field: string,
): { ok: true; value: number | null } | { ok: false; error: string; message: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return {
      ok: false,
      error: `invalid_${field}`,
      message: `${field} must be an integer >= 1 when provided`,
    };
  }
  return { ok: true, value };
}

export function parseCreateInput(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalid('invalid_body', 'Request body must be a JSON object');
  }

  const { content, ttl_seconds: ttl, max_views: maxViews } = body as Record<string, unknown>;

  if (typeof content !== 'string') {
    return invalid('invalid_content', 'content is required and must be a string');
  }
  if (content.length === 0) {
    return invalid('invalid_content', 'content must be a non-empty string');
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
    return invalid('content_too_large', `content must be at most ${MAX_CONTENT_BYTES} bytes`);
  }

  const ttlResult = parseOptionalPositiveInt(ttl, 'ttl_seconds');
  if (!ttlResult.ok) return ttlResult;

  const viewsResult = parseOptionalPositiveInt(maxViews, 'max_views');
  if (!viewsResult.ok) return viewsResult;

  return {
    ok: true,
    value: { content, ttlSeconds: ttlResult.value, maxViews: viewsResult.value },
  };
}

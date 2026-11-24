import { NextResponse } from 'next/server';

/**
 * Every API response is JSON with an explicit content type and no caching,
 * so a 404 for an exhausted paste is never answered from a CDN edge.
 */
export function json<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

export function errorJson(error: string, message: string, status: number): NextResponse {
  return json({ error, message }, status);
}

export const NOT_FOUND_BODY = {
  error: 'not_found',
  message: 'This paste does not exist, has expired, or has reached its view limit',
};

/** Single answer for every unavailable case: missing, expired or exhausted. */
export function notFoundJson(): NextResponse {
  return json(NOT_FOUND_BODY, 404);
}

/** Absolute base URL for shareable links, derived from the request. */
export function baseUrl(request: Request): string {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');

  const headers = request.headers;
  const forwardedHost = headers.get('x-forwarded-host');
  const host = (forwardedHost ?? headers.get('host') ?? '').split(',')[0].trim();
  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0].trim();
  const protocol = forwardedProto ?? new URL(request.url).protocol.replace(':', '');

  if (!host) return new URL(request.url).origin;
  return `${protocol}://${host}`;
}

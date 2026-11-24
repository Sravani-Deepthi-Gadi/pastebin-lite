import { randomInt } from 'node:crypto';
import { getDb } from './db';
import { addSeconds } from './time';
import type { CreateInput } from './validate';

/** Unambiguous alphabet: no 0/O or 1/l/I, so ids survive being read aloud. */
const ID_ALPHABET = '23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const ID_LENGTH = 10;

export function generateId(): string {
  let id = '';
  for (let i = 0; i < ID_LENGTH; i += 1) {
    id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  }
  return id;
}

export interface PasteView {
  content: string;
  remainingViews: number | null;
  expiresAt: Date | null;
}

interface PasteRow {
  content: string;
  views: number;
  max_views: number | null;
  expires_at: string | Date | null;
}

function toView(row: PasteRow): PasteView {
  return {
    content: row.content,
    remainingViews:
      row.max_views === null ? null : Math.max(0, row.max_views - row.views),
    expiresAt: row.expires_at === null ? null : new Date(row.expires_at),
  };
}

export async function createPaste(
  input: CreateInput,
  now: Date,
): Promise<{ id: string; expiresAt: Date | null }> {
  const db = await getDb();
  const expiresAt = input.ttlSeconds === null ? null : addSeconds(now, input.ttlSeconds);

  // Retry guards against the astronomically unlikely id collision.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = generateId();
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO pastes (id, content, max_views, expires_at)
       VALUES ($1, $2, $3::int, $4::timestamptz)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [id, input.content, input.maxViews, expiresAt === null ? null : expiresAt.toISOString()],
    );
    if (inserted.rows.length === 1) return { id, expiresAt };
  }
  throw new Error('Could not allocate a unique paste id');
}

/**
 * Availability conditions, shared by the read paths so both agree on exactly
 * when a paste stops existing.
 */
const AVAILABLE = `
  (expires_at IS NULL OR expires_at > $2::timestamptz)
  AND (max_views IS NULL OR views < max_views)
`;

/**
 * Reads a paste and counts the read as a view, atomically.
 *
 * The guard and the increment are one statement, so Postgres takes a row lock
 * for the duration: under concurrency the (n+1)-th reader of an n-view paste
 * matches no row and gets nothing. There is no read-then-write window, so a
 * paste can never be served beyond its limit and `views` can never pass
 * `max_views`.
 *
 * Returns null when the paste is missing, expired or exhausted.
 */
export async function consumePaste(id: string, now: Date): Promise<PasteView | null> {
  const db = await getDb();
  const result = await db.query<PasteRow>(
    `UPDATE pastes
        SET views = views + 1
      WHERE id = $1
        AND ${AVAILABLE}
      RETURNING content, views, max_views, expires_at`,
    [id, now.toISOString()],
  );
  const row = result.rows[0];
  return row ? toView(row) : null;
}

/** Reads a paste without counting a view. Returns null when unavailable. */
export async function peekPaste(id: string, now: Date): Promise<PasteView | null> {
  const db = await getDb();
  const result = await db.query<PasteRow>(
    `SELECT content, views, max_views, expires_at
       FROM pastes
      WHERE id = $1
        AND ${AVAILABLE}`,
    [id, now.toISOString()],
  );
  const row = result.rows[0];
  return row ? toView(row) : null;
}

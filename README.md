# Pastebin Lite

A small Pastebin-style app: paste some text, get a shareable link, and
optionally make the paste disappear after a time limit, a number of views, or
both. Built with Next.js (App Router) and Postgres, deployed on Vercel.

- **Live app:** _add your deployed URL here_
- **Create a paste:** `/`
- **View a paste:** `/p/<id>`

---

## Quick start

Requirements: Node.js 20+ and npm.

```bash
git clone <this-repo-url>
cd pastebin-lite
npm install
cp .env.example .env.local
```

Then pick one of the two ways to run it.

### Option A — run against a real Postgres database (what production uses)

Create a free Postgres database (for example a [Neon](https://neon.tech)
project) and put its connection string in `.env.local`:

```bash
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
TEST_MODE=1
```

```bash
npm run dev     # development server with hot reload
# or
npm run build && npm start   # production build
```

Open the app at `http://localhost:3000`.

The `pastes` table is created automatically on the first request, so there is
no migration step to run.

### Option B — run with no database to install

For local work without any database server, the app can run against
[PGlite](https://pglite.dev) — real Postgres compiled to WebAssembly, embedded
in the Node process. Set this in `.env.local` instead of `DATABASE_URL`:

```bash
USE_PGLITE=1
TEST_MODE=1
# PGLITE_DIR=.pglite   # optional: persist to disk instead of memory
```

```bash
npm run build && npm start
```

This mode is for development and tests only. It is never used in the
deployment, because an in-process database does not survive across serverless
invocations.

### Environment variables

| Variable          | Required           | Purpose                                                                     |
| ----------------- | ------------------ | --------------------------------------------------------------------------- |
| `DATABASE_URL`    | yes (in production) | Postgres connection string. TLS is enabled when the URL asks for it.       |
| `TEST_MODE`       | no                 | `1` lets the `x-test-now-ms` header drive the clock used for expiry.        |
| `PUBLIC_BASE_URL` | no                 | Base URL for generated links. Derived from the request when unset.          |
| `USE_PGLITE`      | no                 | `1` runs against the embedded WASM Postgres. Local development only.        |
| `PGLITE_DIR`      | no                 | Directory for PGlite to persist to. In-memory when unset.                   |

---

## Persistence layer

**Postgres**, accessed with [`pg`](https://node-postgres.com); the deployment
uses a [Neon](https://neon.tech) serverless Postgres database.

Why Postgres rather than in-memory state or a KV store:

- Every request on Vercel may land on a fresh instance, so paste data has to
  live outside the process.
- Enforcing a view limit is a read-and-increment under concurrency. Postgres
  lets that happen in **one guarded statement** that takes a row lock, which is
  what keeps a paste from being served past its limit. A plain KV store would
  need a compare-and-swap loop or a Lua script to get the same guarantee.
- The schema is one table, created on demand:

  ```sql
  CREATE TABLE IF NOT EXISTS pastes (
    id          TEXT PRIMARY KEY,
    content     TEXT NOT NULL,
    max_views   INTEGER,          -- NULL means unlimited
    views       INTEGER NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ,      -- NULL means no expiry
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```

The connection pool and the schema bootstrap are memoised per instance. That
cache holds a connection, not application data: all paste state is in Postgres,
so a cold start, a new instance, or several concurrent instances all behave
identically.

---

## API

### `GET /api/healthz`

Always `200` with JSON, and the body says whether the database is reachable.

```json
{ "ok": true, "database": "up", "latency_ms": 12 }
```

The database ping is bounded at 2 seconds so the check stays fast even when
Postgres is unreachable; in that case the response is still `200`, with
`"ok": false`.

### `POST /api/pastes`

```json
{ "content": "hello", "ttl_seconds": 60, "max_views": 5 }
```

- `content` — required, non-empty string, up to 512 KB
- `ttl_seconds` — optional integer ≥ 1
- `max_views` — optional integer ≥ 1

`201 Created`:

```json
{
  "id": "ZjVmXvFFfQ",
  "url": "https://your-app.vercel.app/p/ZjVmXvFFfQ",
  "expires_at": "2026-01-01T00:01:00.000Z",
  "max_views": 5
}
```

Invalid input returns `400` with `{ "error": "...", "message": "..." }`.

### `GET /api/pastes/:id`

Each successful fetch counts as one view.

```json
{
  "content": "hello",
  "remaining_views": 4,
  "expires_at": "2026-01-01T00:01:00.000Z"
}
```

`remaining_views` is `null` when views are unlimited, `expires_at` is `null`
when there is no TTL. A paste that is missing, expired, or out of views returns
`404` with a JSON error body.

### `GET /p/:id`

HTML view of the paste, `200` when available and `404` otherwise.

### Deterministic time for testing

When `TEST_MODE=1`, a request may carry `x-test-now-ms: <ms since epoch>` and
that value is used as the current time for expiry logic. Without the header, or
without `TEST_MODE=1`, the real system clock is used.

```bash
curl -X POST "$BASE/api/pastes" \
  -H 'Content-Type: application/json' \
  -H 'x-test-now-ms: 1767225600000' \
  -d '{"content":"hi","ttl_seconds":60}'

# 61 seconds later on the test clock: 404
curl -i "$BASE/api/pastes/<id>" -H 'x-test-now-ms: 1767225661000'
```

---

## Design decisions

**View accounting is a single atomic statement.** Reading a paste and counting
the view happen in one `UPDATE … WHERE … RETURNING`:

```sql
UPDATE pastes
   SET views = views + 1
 WHERE id = $1
   AND (expires_at IS NULL OR expires_at > $2::timestamptz)
   AND (max_views IS NULL OR views < max_views)
RETURNING content, views, max_views, expires_at
```

Postgres holds a row lock for the duration, so there is no read-then-write
window. Under concurrent load on a paste with `max_views = 3`, exactly three
callers match the row and the rest match nothing and get a `404`. `views` can
never pass `max_views`, so `remaining_views` can never go negative.

**A view is an API fetch.** The spec defines a view as a successful
`GET /api/pastes/:id`, so `/p/:id` renders without consuming one. The HTML page
applies the same availability rules, so once a paste is expired or exhausted the
page returns `404` too.

**One answer for every unavailable paste.** Missing, expired, and exhausted all
return the same `404` and the same JSON body, so a caller cannot tell a paste
that never existed from one that has been used up.

**The test clock applies to writes as well as reads.** Expiry is stored as an
absolute timestamp, computed from the same resolved clock that reads use. A
grader that creates a paste and expires it entirely on a simulated clock gets
consistent results, and the header is ignored unless `TEST_MODE=1`.

**The deployment needs no migration step.** The schema bootstrap is idempotent
`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, run once per
instance before the first query. No shell access, no migration job.

**Content is rendered as text, never as HTML.** The paste page interpolates the
content as a React text child inside a `<pre>`, so markup is escaped by the
renderer; there is no `dangerouslySetInnerHTML` anywhere. A paste containing
`<script>` is displayed verbatim and never executed.

**Nothing is cached.** API responses send `Cache-Control: no-store` and all
dynamic routes are `force-dynamic`, so an exhausted paste is never answered
from an edge cache.

**Ids** are 10 characters drawn from a 57-character alphabet with no
look-alikes (no `0`/`O`, no `1`/`l`/`I`), using `crypto.randomInt` — about 58
bits of entropy, so ids are not guessable or enumerable. Insertion uses
`ON CONFLICT DO NOTHING` with a retry, so a collision could never overwrite an
existing paste.

**Validation is strict about types.** `ttl_seconds` and `max_views` must be JSON
integers ≥ 1; `"60"`, `1.5`, `0`, and negatives are all rejected with `400`. An
explicit `null` is treated as "no constraint", the same as omitting the field.
`content` is capped at 512 KB.

---

## Tests

`tests/grader.mjs` covers every automated check in the assignment — health,
creation, retrieval, view limits, TTL (both on the simulated clock and the real
one), combined constraints, error handling, HTML escaping, and a concurrency
check — and runs against any deployment:

```bash
BASE_URL=https://your-app.vercel.app npm run test:e2e
```

Point it at a local server the same way. The target needs `TEST_MODE=1` for the
TTL checks.

---

## Deploying to Vercel

1. Push this repository to GitHub.
2. Create a Postgres database (Neon's free tier works) and copy its connection
   string.
3. Import the repository at [vercel.com/new](https://vercel.com/new).
4. Add the environment variables `DATABASE_URL` and `TEST_MODE=1`.
5. Deploy. The table is created on the first request.

---

## Project structure

```
src/
  app/
    page.tsx                  create-a-paste page
    create-form.tsx           the form (client component)
    p/[id]/page.tsx           HTML paste view, 404s when unavailable
    not-found.tsx             404 page
    api/healthz/route.ts      health check
    api/pastes/route.ts       POST: create a paste
    api/pastes/[id]/route.ts  GET: read a paste, counting a view
  lib/
    db.ts                     Postgres / PGlite driver, schema bootstrap
    pastes.ts                 id generation, atomic read-and-count, peek
    time.ts                   deterministic clock (x-test-now-ms)
    validate.ts               request validation
    http.ts                   JSON responses, base URL resolution
tests/
  grader.mjs                  end-to-end suite
```

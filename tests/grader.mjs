/**
 * Grader-style end-to-end test suite for Pastebin Lite.
 *
 * Covers every automated check listed in the assignment, plus HTML escaping
 * and a concurrency check. Runs against any deployment:
 *
 *   BASE_URL=https://your-app.vercel.app npm run test:e2e
 *
 * TTL checks drive the clock with the x-test-now-ms header, which requires
 * TEST_MODE=1 in the target environment.
 */

const BASE_URL = (process.env.BASE_URL ?? '').replace(/\/+$/, '');

if (!BASE_URL) {
  console.error('BASE_URL is required, e.g. BASE_URL=https://your-app.vercel.app npm run test:e2e');
  process.exit(2);
}

let passed = 0;
const failures = [];

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`${GREEN}pass${RESET} ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`${RED}FAIL${RESET} ${name}\n     ${DIM}${error.message}${RESET}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

function headers(nowMs) {
  const result = { 'Content-Type': 'application/json' };
  if (nowMs !== undefined) result['x-test-now-ms'] = String(nowMs);
  return result;
}

async function createPaste(body, nowMs) {
  const response = await fetch(`${BASE_URL}/api/pastes`, {
    method: 'POST',
    headers: headers(nowMs),
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    /* non-JSON body is itself a failure, reported by the caller */
  }
  return { status: response.status, json, contentType: response.headers.get('content-type') };
}

async function getPaste(id, nowMs) {
  const response = await fetch(`${BASE_URL}/api/pastes/${id}`, { headers: headers(nowMs) });
  let json = null;
  try {
    json = await response.json();
  } catch {
    /* ditto */
  }
  return { status: response.status, json, contentType: response.headers.get('content-type') };
}

async function getHtml(id, nowMs) {
  const response = await fetch(`${BASE_URL}/p/${id}`, {
    headers: nowMs === undefined ? {} : { 'x-test-now-ms': String(nowMs) },
  });
  return { status: response.status, body: await response.text() };
}

/** Creates a paste and asserts it worked, returning the parsed body. */
async function mustCreate(body, nowMs) {
  const created = await createPaste(body, nowMs);
  assert(
    created.status >= 200 && created.status < 300,
    `create should return 2xx, got ${created.status} ${JSON.stringify(created.json)}`,
  );
  assert(created.json !== null, 'create should return JSON');
  return created.json;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(`\nTesting ${BASE_URL}\n`);

// ---------------------------------------------------------------- service

await test('/api/healthz returns 200, JSON content type, and ok:true', async () => {
  const startedAt = Date.now();
  const response = await fetch(`${BASE_URL}/api/healthz`);
  const elapsed = Date.now() - startedAt;
  assertEqual(response.status, 200, 'status');
  assert(
    (response.headers.get('content-type') ?? '').includes('application/json'),
    `content-type should be JSON, got ${response.headers.get('content-type')}`,
  );
  const body = await response.json();
  assertEqual(body.ok, true, 'ok flag (is the persistence layer reachable?)');
  assert(elapsed < 5_000, `health check should be fast, took ${elapsed}ms`);
});

// --------------------------------------------------------------- creation

await test('creating a paste returns an id and a url pointing at /p/:id on this domain', async () => {
  const body = await mustCreate({ content: 'hello world' });
  assert(typeof body.id === 'string' && body.id.length > 0, 'id should be a non-empty string');
  assert(typeof body.url === 'string', 'url should be a string');
  const url = new URL(body.url);
  assertEqual(url.pathname, `/p/${body.id}`, 'url path');
  assertEqual(url.host, new URL(BASE_URL).host, 'url host');
});

await test('response content type is JSON on create', async () => {
  const created = await createPaste({ content: 'content type check' });
  assert(
    (created.contentType ?? '').includes('application/json'),
    `content-type should be JSON, got ${created.contentType}`,
  );
});

// -------------------------------------------------------------- retrieval

await test('fetching an existing paste returns the original content', async () => {
  const content = 'line one\nline two\ttabbed\n"quoted" — unicode éñ 🚀';
  const { id } = await mustCreate({ content });
  const fetched = await getPaste(id);
  assertEqual(fetched.status, 200, 'status');
  assertEqual(fetched.json.content, content, 'content round trip');
  assertEqual(fetched.json.remaining_views, null, 'remaining_views is null when unlimited');
  assertEqual(fetched.json.expires_at, null, 'expires_at is null when there is no TTL');
});

await test('GET /p/:id returns HTML 200 containing the content', async () => {
  const content = 'visible-in-html-' + Math.random().toString(36).slice(2);
  const { id } = await mustCreate({ content });
  const page = await getHtml(id);
  assertEqual(page.status, 200, 'status');
  assert(page.body.includes(content), 'HTML should contain the paste content');
});

await test('paste content is rendered safely (no script execution)', async () => {
  const marker = Math.random().toString(36).slice(2);
  const content = `<script>window.x='${marker}'</script><img src=x onerror="alert(1)">`;
  const { id } = await mustCreate({ content });
  const page = await getHtml(id);
  assertEqual(page.status, 200, 'status');
  assert(!page.body.includes('<script>window.x='), 'script tag must be escaped, not emitted raw');
  assert(!page.body.includes('onerror="alert(1)"'), 'attribute payload must be escaped');
  assert(page.body.includes('&lt;script&gt;'), 'content should appear HTML-escaped');
});

// ------------------------------------------------------------ view limits

await test('max_views = 1: first API fetch 200, second 404', async () => {
  const { id } = await mustCreate({ content: 'one view only', max_views: 1 });
  const first = await getPaste(id);
  assertEqual(first.status, 200, 'first fetch status');
  assertEqual(first.json.remaining_views, 0, 'remaining_views after the only view');
  const second = await getPaste(id);
  assertEqual(second.status, 404, 'second fetch status');
  assert(second.json !== null && typeof second.json === 'object', '404 body should be JSON');
});

await test('max_views = 2: two successful fetches, third 404', async () => {
  const { id } = await mustCreate({ content: 'two views', max_views: 2 });
  const first = await getPaste(id);
  assertEqual(first.status, 200, 'first fetch status');
  assertEqual(first.json.remaining_views, 1, 'remaining after first view');
  const second = await getPaste(id);
  assertEqual(second.status, 200, 'second fetch status');
  assertEqual(second.json.remaining_views, 0, 'remaining after second view');
  const third = await getPaste(id);
  assertEqual(third.status, 404, 'third fetch status');
});

await test('an exhausted paste 404s consistently, including its HTML page', async () => {
  const { id } = await mustCreate({ content: 'burn after reading', max_views: 1 });
  assertEqual((await getPaste(id)).status, 200, 'first fetch');
  for (let i = 0; i < 3; i += 1) {
    const repeat = await getPaste(id);
    assertEqual(repeat.status, 404, `repeat API fetch ${i + 1}`);
  }
  assertEqual((await getHtml(id)).status, 404, 'HTML page status');
});

await test('remaining_views never goes negative', async () => {
  const { id } = await mustCreate({ content: 'no negatives', max_views: 1 });
  const first = await getPaste(id);
  assert(first.json.remaining_views >= 0, 'first fetch remaining_views');
  for (let i = 0; i < 3; i += 1) {
    const extra = await getPaste(id);
    assertEqual(extra.status, 404, 'over-limit fetch should 404');
    assert(
      extra.json.remaining_views === undefined || extra.json.remaining_views >= 0,
      'a 404 body must not report negative remaining_views',
    );
  }
});

// -------------------------------------------------------------------- TTL

await test('a paste with a TTL is available before expiry and 404s after it', async () => {
  const now = Date.now();
  const { id, expires_at } = await mustCreate({ content: 'ttl paste', ttl_seconds: 60 }, now);
  assert(typeof expires_at === 'string', 'create should report expires_at');

  const before = await getPaste(id, now + 30_000);
  assertEqual(before.status, 200, 'status 30s into a 60s TTL');
  assertEqual(before.json.expires_at, new Date(now + 60_000).toISOString(), 'expires_at value');

  const after = await getPaste(id, now + 61_000);
  assertEqual(after.status, 404, 'status 61s into a 60s TTL (requires TEST_MODE=1)');
});

await test('the HTML page 404s after expiry', async () => {
  const now = Date.now();
  const { id } = await mustCreate({ content: 'ttl html', ttl_seconds: 30 }, now);
  assertEqual((await getHtml(id, now + 10_000)).status, 200, 'before expiry');
  assertEqual((await getHtml(id, now + 31_000)).status, 404, 'after expiry');
});

await test('expiry also works on the real clock (ttl_seconds = 1)', async () => {
  const { id } = await mustCreate({ content: 'short ttl' });
  assertEqual((await getPaste(id)).status, 200, 'sanity check on an unconstrained paste');

  const shortLived = await mustCreate({ content: 'expires in a second', ttl_seconds: 1 });
  await sleep(1_500);
  assertEqual((await getPaste(shortLived.id)).status, 404, 'status after the TTL elapsed');
});

// ----------------------------------------------------- combined constraints

await test('TTL + max_views: the view limit can trigger first', async () => {
  const now = Date.now();
  const { id } = await mustCreate(
    { content: 'both constraints, views first', ttl_seconds: 3600, max_views: 1 },
    now,
  );
  assertEqual((await getPaste(id, now)).status, 200, 'first fetch');
  assertEqual((await getPaste(id, now + 1_000)).status, 404, 'second fetch, well before the TTL');
});

await test('TTL + max_views: the TTL can trigger first', async () => {
  const now = Date.now();
  const { id } = await mustCreate(
    { content: 'both constraints, ttl first', ttl_seconds: 10, max_views: 5 },
    now,
  );
  assertEqual((await getPaste(id, now)).status, 200, 'first fetch');
  assertEqual((await getPaste(id, now + 11_000)).status, 404, 'fetch after the TTL, with views left');
});

// --------------------------------------------------------- error handling

const invalidBodies = [
  ['missing content', {}],
  ['empty content', { content: '' }],
  ['content is not a string', { content: 42 }],
  ['content is null', { content: null }],
  ['ttl_seconds = 0', { content: 'x', ttl_seconds: 0 }],
  ['ttl_seconds is negative', { content: 'x', ttl_seconds: -5 }],
  ['ttl_seconds is fractional', { content: 'x', ttl_seconds: 1.5 }],
  ['ttl_seconds is a string', { content: 'x', ttl_seconds: '60' }],
  ['max_views = 0', { content: 'x', max_views: 0 }],
  ['max_views is negative', { content: 'x', max_views: -1 }],
  ['max_views is fractional', { content: 'x', max_views: 2.5 }],
  ['max_views is a string', { content: 'x', max_views: '5' }],
  ['body is an array', []],
];

for (const [label, body] of invalidBodies) {
  await test(`invalid input rejected with a 4xx JSON error: ${label}`, async () => {
    const created = await createPaste(body);
    assert(
      created.status >= 400 && created.status < 500,
      `expected 4xx, got ${created.status} ${JSON.stringify(created.json)}`,
    );
    assert(created.json !== null, 'error body should be JSON');
    assert(
      typeof created.json.error === 'string' || typeof created.json.message === 'string',
      'error body should describe the problem',
    );
  });
}

await test('malformed JSON is rejected with a 4xx JSON error', async () => {
  const response = await fetch(`${BASE_URL}/api/pastes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"content": ',
  });
  assert(response.status >= 400 && response.status < 500, `expected 4xx, got ${response.status}`);
  assert(
    (response.headers.get('content-type') ?? '').includes('application/json'),
    'error response should be JSON',
  );
  await response.json();
});

await test('an unknown id returns 404 JSON from the API and 404 HTML from /p/:id', async () => {
  const id = 'definitely-not-a-real-paste-id';
  const api = await getPaste(id);
  assertEqual(api.status, 404, 'API status');
  assert(
    (api.contentType ?? '').includes('application/json'),
    `404 should be JSON, got ${api.contentType}`,
  );
  assertEqual((await getHtml(id)).status, 404, 'HTML status');
});

// ------------------------------------------------------------- robustness

await test('concurrent load never serves a paste beyond its view limit', async () => {
  const maxViews = 3;
  const attempts = 12;
  const { id } = await mustCreate({ content: 'concurrency', max_views: maxViews });

  const results = await Promise.all(
    Array.from({ length: attempts }, () => getPaste(id)),
  );

  const successes = results.filter((result) => result.status === 200);
  const notFounds = results.filter((result) => result.status === 404);

  assertEqual(successes.length, maxViews, 'number of successful fetches');
  assertEqual(notFounds.length, attempts - maxViews, 'number of 404s');

  for (const success of successes) {
    assert(
      success.json.remaining_views >= 0 && success.json.remaining_views < maxViews,
      `remaining_views out of range: ${success.json.remaining_views}`,
    );
  }
  const remaining = successes.map((success) => success.json.remaining_views).sort();
  assertEqual(
    new Set(remaining).size,
    maxViews,
    'each concurrent reader should see a distinct remaining_views value',
  );
});

// ----------------------------------------------------------------- summary

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  for (const failure of failures) {
    console.log(`${RED}FAIL${RESET} ${failure.name}: ${failure.error.message}`);
  }
  process.exit(1);
}

'use client';

import { useState } from 'react';

interface CreateResponse {
  id: string;
  url: string;
  expires_at: string | null;
  max_views: number | null;
}

interface ErrorResponse {
  error?: string;
  message?: string;
}

export default function CreateForm() {
  const [content, setContent] = useState('');
  const [ttl, setTtl] = useState('');
  const [maxViews, setMaxViews] = useState('');
  const [result, setResult] = useState<CreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function parseOptional(raw: string, label: string): number | null | 'invalid' {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const value = Number(trimmed);
    if (!Number.isInteger(value) || value < 1) {
      setError(`${label} must be a whole number of at least 1.`);
      return 'invalid';
    }
    return value;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (content.length === 0) {
      setError('Paste content cannot be empty.');
      return;
    }

    const ttlSeconds = parseOptional(ttl, 'Expiry');
    if (ttlSeconds === 'invalid') return;
    const views = parseOptional(maxViews, 'View limit');
    if (views === 'invalid') return;

    setSubmitting(true);
    try {
      const response = await fetch('/api/pastes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          ...(ttlSeconds === null ? {} : { ttl_seconds: ttlSeconds }),
          ...(views === null ? {} : { max_views: views }),
        }),
      });

      const body: CreateResponse | ErrorResponse = await response.json();
      if (!response.ok) {
        const failure = body as ErrorResponse;
        setError(failure.message ?? failure.error ?? 'Could not create the paste.');
        return;
      }
      setResult(body as CreateResponse);
      setContent('');
      setTtl('');
      setMaxViews('');
    } catch {
      setError('Network error — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel" onSubmit={onSubmit}>
      <label htmlFor="content">Content</label>
      <textarea
        id="content"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Paste your text here…"
      />

      <div className="row">
        <div>
          <label htmlFor="ttl">Expires after (seconds)</label>
          <input
            id="ttl"
            inputMode="numeric"
            value={ttl}
            onChange={(event) => setTtl(event.target.value)}
            placeholder="optional"
          />
          <p className="hint">Leave blank to never expire.</p>
        </div>
        <div>
          <label htmlFor="max-views">Maximum views</label>
          <input
            id="max-views"
            inputMode="numeric"
            value={maxViews}
            onChange={(event) => setMaxViews(event.target.value)}
            placeholder="optional"
          />
          <p className="hint">Leave blank for unlimited views.</p>
        </div>
      </div>

      <button type="submit" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create paste'}
      </button>

      {error ? <p className="alert" role="alert">{error}</p> : null}

      {result ? (
        <div className="result">
          <strong>Paste created.</strong> Share this link:
          <br />
          <a href={result.url}>{result.url}</a>
        </div>
      ) : null}
    </form>
  );
}

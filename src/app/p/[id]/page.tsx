import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { peekPaste } from '@/lib/pastes';
import { resolveNow } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * GET /p/:id — HTML view of a paste.
 *
 * The spec defines a view as a successful API fetch, so rendering this page
 * checks availability without consuming one. The same availability rules apply,
 * so an expired or exhausted paste renders the 404 page.
 *
 * Content is interpolated as a React text child, never as HTML, so a paste
 * containing markup or <script> is displayed verbatim and never executed.
 */
export default async function PastePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestHeaders = await headers();
  const paste = await peekPaste(id, resolveNow(requestHeaders));

  if (!paste) notFound();

  return (
    <main>
      <h1>Paste</h1>
      <p className="meta">
        <span>id: {id}</span>
        <span>
          views left:{' '}
          {paste.remainingViews === null ? 'unlimited' : paste.remainingViews}
        </span>
        <span>
          expires:{' '}
          {paste.expiresAt === null ? 'never' : paste.expiresAt.toISOString()}
        </span>
      </p>
      <pre className="content">{paste.content}</pre>
      <Link className="back" href="/">
        Create a new paste
      </Link>
    </main>
  );
}

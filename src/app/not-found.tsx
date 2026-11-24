import Link from 'next/link';

/** Rendered with HTTP 404 for a missing, expired or exhausted paste. */
export default function NotFound() {
  return (
    <main>
      <h1>Paste unavailable</h1>
      <p className="sub">
        This paste does not exist, has expired, or has reached its view limit.
      </p>
      <Link className="back" href="/">
        Create a new paste
      </Link>
    </main>
  );
}

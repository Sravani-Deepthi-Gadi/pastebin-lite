import Link from 'next/link';

export default function PasteNotFound() {
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

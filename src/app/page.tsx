import CreateForm from './create-form';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <main>
      <h1>Pastebin Lite</h1>
      <p className="sub">
        Share text behind a link, with an optional time limit and an optional view limit.
      </p>
      <CreateForm />
    </main>
  );
}

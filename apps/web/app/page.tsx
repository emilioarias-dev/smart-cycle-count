import { connection } from 'next/server';
import { getBin } from '../lib/api';

// Milestone 1 shows a single sample bin.
const SAMPLE_BIN_CODE = 'SAMPLE-BIN-01';

export default async function HomePage() {
  // Render on every request (never at build time), so the page always
  // reflects the current state of the API and the database.
  await connection();
  const result = await getBin(SAMPLE_BIN_CODE);

  return (
    <main className="page">
      <header className="header">
        <p className="eyebrow">Smart Cycle Count</p>
        <h1>Sample bin</h1>
        <p className="lead">
          Read from PostgreSQL through the API (<code>GET /bins/{SAMPLE_BIN_CODE}</code>).
        </p>
      </header>

      {result.status === 'ok' && (
        <section className="card" aria-label="Bin details">
          <div className="card-header">
            <h2 className="bin-code">{result.bin.code}</h2>
            <span className="badge">Sample data</span>
          </div>
          <dl className="fields">
            <div>
              <dt>Code</dt>
              <dd>{result.bin.code}</dd>
            </div>
            <div>
              <dt>Database ID</dt>
              <dd>{result.bin.id}</dd>
            </div>
          </dl>
        </section>
      )}

      {result.status === 'not-found' && (
        <section className="card notice" role="status">
          <h2>Bin not found</h2>
          <p>
            The API has no bin with code <code>{result.code}</code>. Load the sample data with{' '}
            <code>npm run db:seed</code>, then reload this page.
          </p>
        </section>
      )}

      {result.status === 'error' && (
        <section className="card error" role="alert">
          <h2>Could not load the bin</h2>
          <p>{result.reason}</p>
          <a className="retry" href="/">
            Try again
          </a>
        </section>
      )}
    </main>
  );
}

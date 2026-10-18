import Link from 'next/link';
import { connection } from 'next/server';
import { StatusCard } from '../components/StatusCard';
import { getWarehouse } from '../lib/api';
import { plural, twoDigits } from '../lib/format';

// The warehouse grid: one row of bins per rack, grouped by aisle. Neutral on
// purpose; risk colors come with the scoring milestone.
export default async function WarehousePage() {
  // Rendered on every request, never at build time.
  await connection();
  const result = await getWarehouse();

  return (
    <main className="page">
      <header className="header">
        <p className="eyebrow">Smart Cycle Count</p>
        <h1>Warehouse</h1>
        <p className="lead">Bins by aisle and rack. Select a bin to see its pallets.</p>
      </header>

      {result.status === 'error' && (
        <StatusCard kind="error" title="Could not load the warehouse" action={{ href: '/', label: 'Try again' }}>
          {result.reason}
        </StatusCard>
      )}

      {result.status === 'not-found' && (
        <StatusCard kind="error" title="Could not load the warehouse">
          The API does not provide the warehouse layout (GET /warehouse returned 404).
        </StatusCard>
      )}

      {result.status === 'ok' && result.data.aisles.length === 0 && (
        <StatusCard kind="notice" title="No bins yet">
          The database has no bins. Load the demo data with <code>npm run db:reset-demo</code>, then reload this page.
        </StatusCard>
      )}

      {result.status === 'ok' &&
        result.data.aisles.map((aisle) => (
          <section key={aisle.aisle} className="aisle" aria-label={`Aisle ${aisle.aisle}`}>
            <h2>Aisle {aisle.aisle}</h2>
            {aisle.racks.map((rack) => (
              <div key={rack.rack} className="rack">
                <p className="rack-label">Rack {twoDigits(rack.rack)}</p>
                <ul className="bin-row">
                  {rack.bins.map((bin) => (
                    <li key={bin.code}>
                      <Link
                        className={`bin-cell${bin.palletCount === 0 ? ' empty' : ''}`}
                        href={`/bins/${bin.code}`}
                        aria-label={`Bin ${bin.code}, ${plural(bin.palletCount, 'pallet')}`}
                      >
                        <span className="bin-cell-code">{bin.code}</span>
                        <span className="bin-cell-meta">
                          {bin.palletCount === 0 ? 'Empty' : plural(bin.palletCount, 'pallet')}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
    </main>
  );
}

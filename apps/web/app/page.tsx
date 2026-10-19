import Link from 'next/link';
import { connection } from 'next/server';
import { RecomputeButton } from '../components/RecomputeButton';
import { StatusCard } from '../components/StatusCard';
import { type WarehouseLayout, getWarehouse } from '../lib/api';
import { plural, twoDigits, utcDateTime } from '../lib/format';

// The warehouse heatmap: one row of bins per rack, grouped by aisle, colored
// by audit priority (D-010). Color always comes with the number and a label.
export default async function WarehousePage() {
  // Rendered on every request, never at build time.
  await connection();
  const result = await getWarehouse();

  return (
    <main className="page">
      <header className="header">
        <p className="eyebrow">Smart Cycle Count</p>
        <h1>Warehouse</h1>
        <p className="lead">Bins by aisle and rack, colored by audit priority. Select a bin to see why.</p>
      </header>

      {result.status === 'ok' && result.data.aisles.length > 0 && (
        <section className="toolbar" aria-label="Scores">
          <ul className="legend" aria-label="Priority bands">
            <li className="legend-item priority-high">High · 70–100</li>
            <li className="legend-item priority-medium">Medium · 40–69</li>
            <li className="legend-item priority-low">Low · 0–39</li>
          </ul>
          <p className="muted scores-as-of">{scoresAsOf(result.data)}</p>
          <RecomputeButton />
        </section>
      )}

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
                        className={`bin-cell ${bin.score ? `priority-${bin.score.priority}` : 'unscored'}`}
                        href={`/bins/${bin.code}`}
                        aria-label={`Bin ${bin.code}, ${bin.score ? `score ${bin.score.value}, ${bin.score.label}` : 'not scored'}, ${plural(bin.palletCount, 'pallet')}`}
                      >
                        <span className="bin-cell-code">{bin.code}</span>
                        <span className="bin-cell-score">
                          {bin.score ? (
                            <>
                              <strong>{bin.score.value}</strong> {shortLabel(bin.score.priority)}
                            </>
                          ) : (
                            'Not scored'
                          )}
                        </span>
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

function shortLabel(priority: 'low' | 'medium' | 'high'): string {
  return { low: 'Low', medium: 'Medium', high: 'High' }[priority];
}

// All scores share one reference after a recompute; say so if they do not.
function scoresAsOf(layout: WarehouseLayout): string {
  const references = new Set(
    layout.aisles.flatMap((a) => a.racks.flatMap((r) => r.bins.map((b) => b.score?.reference ?? null))),
  );
  if (references.size === 1) {
    const [only] = references;
    return only ? `Scores as of ${utcDateTime(only)}` : 'Not scored yet: recompute the scores.';
  }
  return 'Scores have different reference times: recompute to align them.';
}

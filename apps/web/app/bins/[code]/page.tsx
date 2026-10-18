import Link from 'next/link';
import { connection } from 'next/server';
import { StatusCard } from '../../../components/StatusCard';
import { type ScoreDetail, getBin } from '../../../lib/api';
import { auditLabel, plural, twoDecimals, twoDigits, utcDateTime } from '../../../lib/format';

// Bin detail: risk score and why, location, audit antecedent and pallets.
export default async function BinPage({ params }: { params: Promise<{ code: string }> }) {
  await connection();
  const { code } = await params;
  const requested = decodeURIComponent(code);
  const result = await getBin(requested);

  return (
    <main className="page">
      <nav>
        <Link className="back" href="/">
          ← Warehouse
        </Link>
      </nav>

      {result.status === 'error' && (
        <StatusCard kind="error" title="Could not load the bin" action={{ href: `/bins/${code}`, label: 'Try again' }}>
          {result.reason}
        </StatusCard>
      )}

      {result.status === 'not-found' && (
        <StatusCard kind="notice" title="Bin not found" action={{ href: '/', label: 'Back to the warehouse' }}>
          There is no bin with code <code>{requested}</code>.
        </StatusCard>
      )}

      {result.status === 'ok' && (
        <>
          <header className="header">
            <p className="eyebrow">Bin</p>
            <h1 className="bin-title">{result.data.code}</h1>
            <p className="lead">
              Aisle {result.data.aisle} · Rack {twoDigits(result.data.rack)} · Position {twoDigits(result.data.position)}
            </p>
          </header>

          <ScoreCard score={result.data.score} />

          <section className="card" aria-label="Bin facts">
            <dl className="fields">
              <div>
                <dt>Last audit</dt>
                <dd>{auditLabel(result.data.lastAuditedAt)}</dd>
              </div>
              <div>
                <dt>Pallets</dt>
                <dd>{result.data.pallets.length}</dd>
              </div>
              <div>
                <dt>Inventory version</dt>
                <dd>{result.data.inventoryVersion}</dd>
              </div>
            </dl>
            <p className="footnote">
              The last audit date is simulated demo data; there are no audit results behind it yet.
            </p>
          </section>

          <section className="pallets" aria-label="Pallets in this bin">
            <h2>Pallets</h2>
            {result.data.pallets.length === 0 ? (
              <p className="muted">This bin is empty.</p>
            ) : (
              <ul className="pallet-list">
                {result.data.pallets.map((pallet) => (
                  <li key={pallet.code} className="pallet">
                    <div>
                      <p className="pallet-code">{pallet.code}</p>
                      <p className="pallet-product">
                        {pallet.product.name} <span className="muted">· {pallet.product.sku}</span>
                      </p>
                    </div>
                    <p className="pallet-quantity">{plural(pallet.quantity, pallet.product.unit)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

// The stored breakdown: each factor's input, cap, weight and contribution,
// summed and rounded once (D-010).
function ScoreCard({ score }: { score: ScoreDetail | null }) {
  if (!score) {
    return (
      <section className="card notice" aria-label="Risk score">
        <h2>Not scored yet</h2>
        <p>Recompute the scores from the warehouse page.</p>
      </section>
    );
  }
  const { age, activity, adjustments } = score.breakdown.factors;
  const rows = [
    {
      name: 'Time since last audit',
      input: age.neverAudited ? 'Never audited (counts as the maximum)' : `${twoDecimals(age.input)} days`,
      factor: age,
      cap: `${age.cap} days`,
    },
    { name: 'Activity (putaway, pick, move)', input: plural(activity.input, 'movement'), factor: activity, cap: `${activity.cap}` },
    { name: 'Adjustments', input: plural(adjustments.input, 'adjustment'), factor: adjustments, cap: `${adjustments.cap}` },
  ];

  return (
    <section className={`card score-card priority-${score.priority}`} aria-label="Risk score">
      <div className="score-headline">
        <p className="score-value">{score.value}</p>
        <div>
          <p className="score-label">{score.label}</p>
          <p className="muted">As of {utcDateTime(score.reference)}</p>
        </div>
      </div>

      <h2>Why this score</h2>
      <table className="breakdown">
        <thead>
          <tr>
            <th scope="col">Factor</th>
            <th scope="col">Input</th>
            <th scope="col">Cap</th>
            <th scope="col">Weight</th>
            <th scope="col">Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <th scope="row">{row.name}</th>
              <td>{row.input}</td>
              <td>{row.cap}</td>
              <td>{row.factor.weight}</td>
              <td>{twoDecimals(row.factor.contribution)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={4}>
              Total (rounded once to the score)
            </th>
            <td>
              {twoDecimals(score.breakdown.total)} → {score.value}
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="footnote">
        Each factor counts input ÷ cap (at most 1) × weight. Activity and adjustments are counted in the 30 days up to{' '}
        {utcDateTime(score.breakdown.window.to)}. This is a heuristic priority for audits, not a probability of error.
      </p>
    </section>
  );
}

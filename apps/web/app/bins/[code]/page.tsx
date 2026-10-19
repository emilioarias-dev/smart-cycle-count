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
              The last audit date is the latest count; before a bin is counted it is simulated demo data, with no result behind it.
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
  const { age, activity, adjustments, lastResult } = score.breakdown.factors;
  // Three columns so the table fits a phone: factor (weight), input of cap,
  // points.
  const rows = [
    {
      name: 'Time since last audit',
      input: age.neverAudited ? `Never audited (counts as ${age.cap} days)` : `${twoDecimals(age.input)} of ${age.cap} days`,
      factor: age,
    },
    {
      name: 'Activity (putaway, pick, move)',
      input: `${activity.input} of ${plural(activity.cap, 'movement')}`,
      factor: activity,
    },
    { name: 'Adjustments', input: `${adjustments.input} of ${adjustments.cap}`, factor: adjustments },
    // Formula v2 (D-012). No count yet is unknown, not PASS.
    ...(lastResult
      ? [
          {
            name: 'Last count result',
            input:
              lastResult.result === null
                ? 'Unknown (never counted)'
                : `${lastResult.result} on ${utcDateTime(lastResult.countedAt!)}`,
            factor: lastResult,
          },
        ]
      : []),
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
            <th scope="col">Factor (weight)</th>
            <th scope="col">Input / cap</th>
            <th scope="col" className="points">
              Points
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <th scope="row">
                {row.name} <span className="muted">({row.factor.weight})</span>
              </th>
              <td>{row.input}</td>
              <td className="points">{twoDecimals(row.factor.contribution)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={2}>
              Total, rounded once to the score
            </th>
            <td className="points">
              {twoDecimals(score.breakdown.total)}
              <br />→ {score.value}
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="footnote">
        Points = weight × input ÷ cap, with the input counted at most up to its cap; the last count adds its full weight only if it
        failed. Formula version {score.formulaVersion}. Activity and adjustments are counted in the 30 days up to{' '}
        {utcDateTime(score.breakdown.window.to)}. This is a heuristic priority for audits, not a probability of error.
      </p>
    </section>
  );
}

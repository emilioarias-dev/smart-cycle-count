import Link from 'next/link';
import { connection } from 'next/server';
import { Icon } from '../../../components/Icon';
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
    <main className="shell">
      <section className="page-head">
        <div>
          <Link className="back" href="/">
            <Icon name="back" />
            Warehouse
          </Link>
          <p className="eyebrow">Bin/</p>
          <h1>
            {result.status === 'ok' ? result.data.code : requested}
            <span className="dot">.</span>
          </h1>
          {result.status === 'ok' && (
            <p className="page-meta">
              <span>
                Aisle {result.data.aisle} · Rack {twoDigits(result.data.rack)} · Position {twoDigits(result.data.position)}
              </span>
              <span>
                Inventory version <b className="num">{result.data.inventoryVersion}</b>
              </span>
            </p>
          )}
        </div>
      </section>

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
        <div className="two">
          <ScoreCard score={result.data.score} />

          <div className="side">
            <section className="panel" aria-label="Bin facts">
              <dl className="facts">
                <div>
                  <dt>Last audit</dt>
                  <dd>{auditLabel(result.data.lastAuditedAt)}</dd>
                </div>
                <div>
                  <dt>Pallets</dt>
                  <dd className="num">{result.data.pallets.length}</dd>
                </div>
                <div>
                  <dt>Last count</dt>
                  <dd>{lastCount(result.data.score)}</dd>
                </div>
              </dl>
              <p className="facts-note">
                The last audit date is the latest count; before a bin is counted it is simulated demo data, with no result behind it.
              </p>
            </section>

            <section className="panel" aria-labelledby="pallets-title">
              <div className="panel-head">
                <h2 id="pallets-title">
                  Pallets<span className="dot">.</span>
                </h2>
              </div>
              <div className="panel-body">
                {result.data.pallets.length === 0 ? (
                  <p className="muted">This bin is empty.</p>
                ) : (
                  <ul className="pallet-list">
                    {result.data.pallets.map((pallet) => (
                      <li key={pallet.code}>
                        <span>
                          <span className="code">{pallet.code}</span>
                          <span className="subline">
                            {pallet.product.name} · {pallet.product.sku}
                          </span>
                        </span>
                        <span className="qty num">{plural(pallet.quantity, pallet.product.unit)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </main>
  );
}

// The last count result as the stored score saw it (formula v2, D-012).
function lastCount(score: ScoreDetail | null): string {
  const last = score?.breakdown.factors.lastResult;
  if (!last) {
    return '—';
  }
  return last.result === null ? 'None yet' : `${last.result}, ${last.countedAt!.slice(0, 10)}`;
}

// The stored breakdown: each factor's input, cap, weight and contribution,
// summed and rounded once (D-010). Each bar uses the same 0–100 scale.
function ScoreCard({ score }: { score: ScoreDetail | null }) {
  if (!score) {
    return (
      <StatusCard kind="notice" title="Not scored yet">
        Recompute the scores from the warehouse page.
      </StatusCard>
    );
  }
  const { age, activity, adjustments, lastResult } = score.breakdown.factors;
  const rows = [
    {
      name: 'Time since last audit',
      input: age.neverAudited ? `Never audited (counts as ${age.cap} days)` : `${twoDecimals(age.input)} of ${age.cap} days`,
      factor: age,
      color: 'var(--f-age)',
    },
    {
      name: 'Activity',
      input: `${activity.input} of ${plural(activity.cap, 'movement')} (putaway, pick, move)`,
      factor: activity,
      color: 'var(--f-activity)',
    },
    { name: 'Adjustments', input: `${adjustments.input} of ${adjustments.cap}`, factor: adjustments, color: 'var(--f-adjustments)' },
    // Formula v2 (D-012). No count yet is unknown, not PASS.
    ...(lastResult
      ? [
          {
            name: 'Last count result',
            input: lastResult.result === null ? 'Unknown (never counted)' : `${lastResult.result} on ${utcDateTime(lastResult.countedAt!)}`,
            factor: lastResult,
            color: 'var(--f-last)',
          },
        ]
      : []),
  ];

  return (
    <section className="panel" aria-labelledby="score-title">
      <div className="panel-head">
        <h2 id="score-title">
          Risk score<span className="dot">.</span>
        </h2>
        <p className="panel-sub">
          As of {utcDateTime(score.reference)} · formula version {score.formulaVersion}
        </p>
      </div>
      <div className="score-hero">
        <span className="value num">{score.value}</span>
        <span className={`chip ${score.priority}`}>{score.label}</span>
      </div>
      <div className="panel-body">
        <h3 className="eyebrow">Why this score/</h3>
        {rows.map((row) => (
          <div key={row.name} className="why-row">
            <span className="name">
              {row.name} <small>(weight {row.factor.weight})</small>
            </span>
            <span className="factor-input">{row.input}</span>
            <span className="mini" role="img" aria-label={`${twoDecimals(row.factor.contribution)} of 100 points`}>
              <span style={{ width: `${row.factor.contribution}%`, background: row.color }} />
            </span>
            <span className="pts num">{twoDecimals(row.factor.contribution)}</span>
          </div>
        ))}
        <div className="why-total num">
          <span>Total, rounded once</span>
          <span>
            {twoDecimals(score.breakdown.total)} → {score.value}
          </span>
        </div>
        <p className="note">
          <Icon name="info" />
          <span>
            Points = weight × input ÷ cap, with the input counted at most up to its cap; the last count adds its full weight only if it failed.
            Activity and adjustments are counted in the 30 days up to {utcDateTime(score.breakdown.window.to)}. A heuristic priority for audits,
            not a probability of error.
          </span>
        </p>
      </div>
    </section>
  );
}

import Link from 'next/link';
import type { RivyFact } from '../lib/api';
import { utcDateTime } from '../lib/format';

// The records an answer was built from, as the API read them (D-016): scores,
// bands, times and count results come from here, not from the model's text.

const band = (label: string) => label.toLowerCase().split(' ')[0];
const time = (iso: string | null) => (iso ? utcDateTime(iso) : '—');
const bin = (code: string) => <Link href={`/bins/${code}`}>{code}</Link>;
const score = (s: { value: number; band: string } | null) =>
  s ? <span className={`chip ${band(s.band)}`}>{`${s.value} ${band(s.band)[0].toUpperCase()}${band(s.band).slice(1)}`}</span> : <span className="subline">No score</span>;

export function RivyFacts({ facts }: { facts: RivyFact[] }) {
  if (facts.length === 0) {
    return null;
  }
  return (
    <section className="rivy-facts" aria-label="Records read">
      <p className="eyebrow">Records read</p>
      {facts.map((f, i) => (
        <div key={i} className="rivy-fact">
          {f.kind === 'missing' && <p className="note">{f.message}</p>}
          {f.kind === 'rules' && <p className="subline">Rules version {f.version}</p>}
          {f.kind === 'bin' && (
            <>
              <p className="rivy-fact-head">
                {bin(f.code)} {score(f.score)} <span className="subline">Score time {time(f.score?.scoreTime ?? null)}</span>
              </p>
              {f.factors.length > 0 && (
                <div className="rivy-fact-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Factor</th>
                        <th>Input</th>
                        <th className="right">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.factors.map((x) => (
                        <tr key={x.factor}>
                          <td>{x.factor}</td>
                          <td>{x.input}</td>
                          <td className="right">{x.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="subline">
                Last audit {f.lastAudit ? time(f.lastAudit) : 'never'} · {f.pallets} {f.pallets === 1 ? 'pallet' : 'pallets'}
                {f.pendingPlan !== null ? ` · pending task in plan #${f.pendingPlan}` : ''}
              </p>
            </>
          )}
          {f.kind === 'compare' && (
            <>
              <p className="rivy-fact-head">
                {f.first ? <>First: {bin(f.first)}</> : 'Not ranked'} <span className="subline">{f.decidedBy}</span>
              </p>
              <div className="rivy-fact-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Bin</th>
                      <th>Score</th>
                      <th>Score time</th>
                      <th>New plan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.bins.map((b) => (
                      <tr key={b.code}>
                        <td>{bin(b.code)}</td>
                        <td>{score(b.score)}</td>
                        <td>{time(b.score?.scoreTime ?? null)}</td>
                        <td>{b.forNewPlan}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {f.kind === 'top' && (
            <div className="rivy-fact-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Bin</th>
                    <th>Score</th>
                    <th>Score time</th>
                  </tr>
                </thead>
                <tbody>
                  {f.bins.map((b) => (
                    <tr key={b.code}>
                      <td>{b.rank}</td>
                      <td>{bin(b.code)}</td>
                      <td>{score(b.score)}</td>
                      <td>{time(b.score.scoreTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {f.kind === 'history' && (
            <>
              <p className="rivy-fact-head">
                {bin(f.code)} <span className="subline">Current score {f.current ? `${f.current.value} · score time ${time(f.current.scoreTime)}` : 'none'}</span>
              </p>
              {f.note && <p className="note">{f.note}</p>}
              {f.tasks.map((t) => (
                <div key={t.planId} className="rivy-fact-task">
                  <p className="subline">
                    Plan #{t.planId} · {t.status} · score at selection {t.atSelection.value} · {t.count ? `count ${t.count.result} at ${time(t.count.countedAt)}` : 'not counted'}
                    {t.count && t.count.unexpected > 0 ? ` · ${t.count.unexpected} unexpected` : ''}
                  </p>
                  {t.count && (
                    <div className="rivy-fact-scroll">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Pallet</th>
                            <th className="right">Expected</th>
                            <th className="right">Counted</th>
                            <th className="right">Variance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {t.count.lines.map((l) => (
                            <tr key={l.pallet}>
                              <td>
                                {l.pallet} <span className="subline">{l.sku}</span>
                              </td>
                              <td className="right">{l.expected}</td>
                              <td className="right">{l.counted}</td>
                              <td className="right">
                                {l.variance > 0 ? `+${l.variance}` : l.variance} {l.unit}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      ))}
    </section>
  );
}

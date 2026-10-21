'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import type { AuditInsights as Insights, BinInsights, Ratio, ScopeInsights } from '../lib/api';
import { plural, utcDateTime } from '../lib/format';
import { Icon } from './Icon';
import { ResultBadge } from './TaskState';

// "Audit insights" (D-019): what part of the warehouse was counted in the
// last 30 days and what the saved counts found. Every figure comes from the
// API's answer; here the scope only picks which of its scopes to show, and a
// selection only filters the list of bins under the chart.

type Part = 'pass' | 'fail' | 'none';
const PARTS: { key: Part; name: string; long: string }[] = [
  { key: 'pass', name: 'PASS', long: 'latest count PASS' },
  { key: 'fail', name: 'FAIL', long: 'latest count FAIL' },
  { key: 'none', name: 'No count', long: 'no count in the period' },
];

function partOf(bin: BinInsights): Part {
  return bin.latest === null ? 'none' : bin.latest.result === 'PASS' ? 'pass' : 'fail';
}

function percent(ratio: Ratio): string {
  return ratio.percent === null ? '' : `${ratio.percent}%`;
}

export function AuditInsights({ data }: { data: Insights }) {
  const whole = data.scopes.find((s) => s.aisle === null)!;
  const aisles = data.scopes.filter((s) => s.aisle !== null);
  const [scope, setScope] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ aisle: string; part: Part } | null>(null);
  const controls = useRef(new Map<string, HTMLButtonElement>());

  const current = data.scopes.find((s) => s.aisle === scope) ?? whole;
  const shown = scope === null ? aisles : aisles.filter((a) => a.aisle === scope);
  const selected = selection ? data.bins.filter((b) => b.aisle === selection.aisle && partOf(b) === selection.part) : [];

  function changeScope(next: string | null) {
    setScope(next);
    setSelection(null);
  }

  function select(aisle: string, part: Part) {
    setSelection(selection?.aisle === aisle && selection.part === part ? null : { aisle, part });
  }

  function clear() {
    const key = selection ? `${selection.aisle}:${selection.part}` : null;
    setSelection(null);
    // The Clear button goes away: the focus returns to the part's label.
    if (key) {
      controls.current.get(key)?.focus();
    }
  }

  return (
    <>
      <p className="ins-period">
        <Icon name="clock" />
        <span>
          Last {data.period.days} days: after <b>{utcDateTime(data.period.start)}</b> up to <b>{utcDateTime(data.period.end)}</b>, the time of this
          request. Saved counts of all plans.
        </span>
      </p>

      <fieldset className="ins-scope">
        <legend>Scope</legend>
        {[null, ...aisles.map((a) => a.aisle)].map((aisle) => (
          <label key={aisle ?? 'all'}>
            <input type="radio" name="insights-scope" checked={scope === aisle} onChange={() => changeScope(aisle)} />
            <span>{aisle === null ? 'All aisles' : `Aisle ${aisle}`}</span>
          </label>
        ))}
      </fieldset>

      <div className="ins-fade" key={`metrics-${scope}`}>
        <Metrics scope={current} />
      </div>

      <div className="ins-chart">
        <h3>Latest count result per bin</h3>
        <p className="ins-sub">
          Each bin once, by its latest saved count in the period: not every count, and not only the latest plan. These are count results, not
          priority bands.
        </p>
        <ul className="ins-key" aria-label="Parts of each bar">
          {PARTS.map((p) => (
            <li key={p.key}>
              <i className={`ins-swatch ${p.key}`} />
              {p.key === 'none' ? 'No count in the period' : `Latest count ${p.name}`}
            </li>
          ))}
        </ul>
        {current.counts.total === 0 && current.bins > 0 && (
          <p className="note">
            <Icon name="info" />
            <span>No count was saved in this scope during the period: every bin is shown without a count.</span>
          </p>
        )}
        <ul className="ins-rows ins-fade" key={`rows-${scope}`}>
          {shown.map((a) => (
            <AisleBar
              key={a.aisle}
              aisle={a}
              selection={selection}
              onSelect={select}
              register={(key, el) => (el ? controls.current.set(key, el) : controls.current.delete(key))}
            />
          ))}
        </ul>
      </div>

      <div className="ins-list">
        <p className="sr-only" role="status">
          {selection
            ? `Listing ${plural(selected.length, 'bin')} of aisle ${selection.aisle} with ${PARTS.find((p) => p.key === selection.part)!.long}.`
            : ''}
        </p>
        {selection ? (
          <div className="ins-fade" key={`list-${selection.aisle}-${selection.part}`}>
            <div className="ins-list-head">
              <p>
                <b>Aisle {selection.aisle}</b> · {PARTS.find((p) => p.key === selection.part)!.long} · {plural(selected.length, 'bin')}
                <span className="muted"> (the figures above are unchanged)</span>
              </p>
              <button type="button" className="btn btn-outline btn-sm" onClick={clear}>
                Clear selection
              </button>
            </div>
            {selected.length === 0 ? (
              <p className="muted ins-empty">
                No bin of aisle {selection.aisle} has {PARTS.find((p) => p.key === selection.part)!.long}.
              </p>
            ) : (
              <table className="table ins-table">
                <thead>
                  <tr>
                    <th scope="col">Bin</th>
                    <th scope="col">Latest result in the period</th>
                    <th scope="col" className="right">
                      Counts
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selected.map((bin) => (
                    <tr key={bin.code}>
                      <td>
                        <Link className="code" href={`/bins/${bin.code}`}>
                          {bin.code}
                        </Link>
                      </td>
                      <td>
                        {bin.latest ? (
                          <span className="ins-latest">
                            <ResultBadge result={bin.latest.result} small />
                            <span className="num">{utcDateTime(bin.latest.countedAt)}</span>
                          </span>
                        ) : (
                          <span className="muted">No count in the period</span>
                        )}
                      </td>
                      <td className="right num">{bin.counts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <p className="ins-hint">
            <Icon name="list" />
            Select a part of a bar, or its label, to list those bins.
          </p>
        )}
      </div>

      <p className="note">
        <Icon name="info" />
        <span>
          Demo data. The observed FAIL proportion describes the counts saved, not the errors of the whole warehouse: bins are chosen by priority
          and can be counted more than once.
        </span>
      </p>
    </>
  );
}

function Metrics({ scope }: { scope: ScopeInsights }) {
  const { coverage, counts, failProportion } = scope;
  return (
    <div className="ins-metrics">
      <div className="ins-metric">
        <span className="ins-metric-title">Coverage</span>
        {coverage.denominator === 0 ? (
          <span className="ins-metric-value">
            <small>No bins</small>
          </span>
        ) : (
          <span className="ins-metric-value num">
            {coverage.numerator}
            <small> / {plural(coverage.denominator, 'bin')}</small>
            <em>{percent(coverage)}</em>
          </span>
        )}
        <span className="ins-metric-detail">Bins with at least one saved count in the period, of the bins in the scope now</span>
      </div>
      <div className="ins-metric">
        <span className="ins-metric-title">Counts recorded</span>
        <span className="ins-metric-value num">{counts.total}</span>
        <span className="ins-metric-detail num">
          {counts.pass} PASS · {counts.fail} FAIL
        </span>
      </div>
      <div className="ins-metric">
        <span className="ins-metric-title">Observed FAIL proportion</span>
        {failProportion.denominator === 0 ? (
          <span className="ins-metric-value">
            <small>No counts</small>
          </span>
        ) : (
          <span className="ins-metric-value num">
            {failProportion.numerator}
            <small> / {plural(failProportion.denominator, 'count')}</small>
            <em>{percent(failProportion)}</em>
          </span>
        )}
        <span className="ins-metric-detail">FAIL counts of the counts observed in the period</span>
      </div>
    </div>
  );
}

function AisleBar(props: {
  aisle: ScopeInsights;
  selection: { aisle: string; part: Part } | null;
  onSelect: (aisle: string, part: Part) => void;
  register: (key: string, el: HTMLButtonElement | null) => void;
}) {
  const { aisle: scope, selection, onSelect, register } = props;
  const aisle = scope.aisle!;
  const values: Record<Part, number> = scope.latestResults;
  const isSelected = (part: Part) => selection?.aisle === aisle && selection.part === part;
  return (
    <li className={`ins-row${selection ? ' has-selection' : ''}`}>
      <p className="ins-row-head">
        <b>Aisle {aisle}</b>
        <span className="muted">{plural(scope.bins, 'bin')}</span>
      </p>
      {/* Pointer and touch target; the labels below are the same controls
          for the keyboard and screen readers. */}
      <div className="ins-bar" aria-hidden="true">
        {PARTS.filter((p) => values[p.key] > 0).map((p) => (
          <button
            key={p.key}
            type="button"
            tabIndex={-1}
            className={`ins-seg ${p.key}${isSelected(p.key) ? ' selected' : ''}`}
            style={{ flexGrow: values[p.key] }}
            onClick={() => onSelect(aisle, p.key)}
          />
        ))}
      </div>
      <div className="ins-parts" role="group" aria-label={`Aisle ${aisle}: bins by latest result in the period`}>
        {PARTS.map((p) => (
          <button
            key={p.key}
            ref={(el) => register(`${aisle}:${p.key}`, el)}
            type="button"
            className={`ins-part ${p.key}`}
            aria-pressed={isSelected(p.key)}
            aria-label={`${p.long}: ${plural(values[p.key], 'bin')}`}
            onClick={() => onSelect(aisle, p.key)}
          >
            <i className={`ins-swatch ${p.key}`} aria-hidden="true" />
            {p.key !== 'none' && <Icon name={p.key === 'pass' ? 'check' : 'x'} />}
            {p.name}
            <b className="num">{values[p.key]}</b>
          </button>
        ))}
      </div>
    </li>
  );
}

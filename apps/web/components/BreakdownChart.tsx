'use client';

import { useRef, useState } from 'react';
import type { TopScore } from '../lib/api';
import { twoDecimals } from '../lib/format';

// "Score breakdown · Top 5 bins": each bar stacks the stored points per factor
// on one 0–100 scale. Hover or keyboard focus shows the values in a tooltip;
// a click, tap or Enter opens them under the bar (and closes them again).

const FACTORS = [
  { key: 'age', name: 'Time since audit', color: 'var(--f-age)' },
  { key: 'activity', name: 'Activity', color: 'var(--f-activity)' },
  { key: 'adjustments', name: 'Adjustments', color: 'var(--f-adjustments)' },
  { key: 'lastResult', name: 'Last count FAIL', color: 'var(--f-last)' },
] as const;
const TICKS = [0, 25, 50, 75, 100];

function points(entry: TopScore): { name: string; color: string; value: number }[] {
  const factors = entry.score.breakdown.factors;
  // Formula v1 breakdowns have no last-result factor: it adds nothing.
  return FACTORS.map((f) => ({ name: f.name, color: f.color, value: factors[f.key]?.contribution ?? 0 }));
}

export function BreakdownChart({ entries }: { entries: TopScore[] }) {
  const chart = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [tip, setTip] = useState<{ code: string; left: number; top: number } | null>(null);

  function showTip(code: string, button: HTMLElement) {
    const box = chart.current?.getBoundingClientRect();
    if (!box) {
      return;
    }
    const row = button.getBoundingClientRect();
    setTip({ code, left: Math.max(0, Math.min(row.left - box.left + 80, box.width - 200)), top: row.top - box.top });
  }

  function toggle(code: string) {
    const next = new Set(open);
    if (next.has(code)) {
      next.delete(code);
    } else {
      next.add(code);
    }
    setOpen(next);
    setTip(null);
  }

  const tipEntry = tip ? entries.find((e) => e.binCode === tip.code) : undefined;

  return (
    <>
      <ul className="factor-key" aria-label="Factors">
        {FACTORS.map((f) => (
          <li key={f.key}>
            <i style={{ background: f.color }} />
            {f.name}
          </li>
        ))}
      </ul>
      <div className="chart" ref={chart}>
        <div className="chart-axis" aria-hidden="true">
          <span />
          <span className="ticks">
            {TICKS.map((t) => (
              <span key={t} style={{ left: `${t}%` }}>
                {t}
              </span>
            ))}
          </span>
          <span />
        </div>
        <ol className="chart-list">
          {entries.map((entry) => {
            const values = points(entry);
            const id = `breakdown-${entry.binCode}`;
            const expanded = open.has(entry.binCode);
            return (
              <li key={entry.binCode}>
                <button
                  type="button"
                  className="chart-row"
                  aria-expanded={expanded}
                  aria-controls={id}
                  aria-label={`${entry.binCode}: ${entry.score.value} points. ${values.map((v) => `${v.name} ${v.value.toFixed(1)}`).join(', ')}`}
                  onMouseEnter={(e) => showTip(entry.binCode, e.currentTarget)}
                  onMouseLeave={() => setTip(null)}
                  onFocus={(e) => showTip(entry.binCode, e.currentTarget)}
                  onBlur={() => setTip(null)}
                  onClick={() => toggle(entry.binCode)}
                >
                  <span className="code">{entry.binCode}</span>
                  <span className="track">
                    {values.map((v) => (
                      <span key={v.name} style={{ width: `${v.value}%`, background: v.color }} />
                    ))}
                  </span>
                  <span className="total num">{entry.score.value}</span>
                </button>
                <div className="chart-detail" id={id} hidden={!expanded}>
                  <dl>
                    {values.map((v) => (
                      <div key={v.name} style={{ display: 'contents' }}>
                        <dt>{v.name}</dt>
                        <dd>{twoDecimals(v.value)}</dd>
                      </div>
                    ))}
                    <dt>Total, rounded once</dt>
                    <dd>
                      {twoDecimals(entry.score.breakdown.total)} → {entry.score.value}
                    </dd>
                  </dl>
                </div>
              </li>
            );
          })}
        </ol>
        {tip && tipEntry && (
          <div className="tooltip" role="presentation" style={{ left: tip.left, top: tip.top, transform: 'translateY(calc(-100% - 6px))' }}>
            <b>
              {tipEntry.binCode} · {tipEntry.score.value} points
            </b>
            <dl>
              {points(tipEntry).map((v) => (
                <div key={v.name} style={{ display: 'contents' }}>
                  <dt>{v.name}</dt>
                  <dd>{v.value.toFixed(1)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </>
  );
}

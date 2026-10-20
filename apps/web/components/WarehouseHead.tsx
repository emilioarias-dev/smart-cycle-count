'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { type CreatePlanState, type RecomputeState, createPlanAction, recomputeScoresAction } from '../app/actions';
import { Icon } from './Icon';

// The warehouse heading with its two actions: recompute every score (D-010)
// and create a Top N plan (D-011, the API validates N). On phones the
// recompute button is an icon next to the score time; it keeps its name.
export function WarehouseHead({ binCount, aisleCount, scoresAsOf }: { binCount: number; aisleCount: number; scoresAsOf: string }) {
  const [recompute, recomputeAction, recomputing] = useActionState<RecomputeState>(recomputeScoresAction, { status: 'idle' });
  const [plan, planAction, creating] = useActionState<CreatePlanState, FormData>(createPlanAction, { status: 'idle' });

  return (
    <>
      <section className="page-head">
        <div>
          <p className="eyebrow">Audit priority/</p>
          <h1>
            Warehouse<span className="dot">.</span>
          </h1>
          <p className="page-meta">
            <span className="hide-sm">
              <b className="num">{binCount}</b> {binCount === 1 ? 'bin' : 'bins'} · {aisleCount} {aisleCount === 1 ? 'aisle' : 'aisles'}
            </span>
            <span>{scoresAsOf}</span>
            <button
              type="submit"
              form="recompute-scores"
              className="icon-btn only-sm"
              disabled={recomputing}
              aria-busy={recomputing}
              aria-label={recomputing ? 'Recomputing scores' : 'Recompute scores'}
              title="Recompute scores"
            >
              <Icon name="refresh" className={recomputing ? 'spinning' : ''} />
            </button>
          </p>
        </div>
        <div className="actions">
          <form id="recompute-scores" action={recomputeAction} hidden />
          <button type="submit" form="recompute-scores" className="btn btn-outline hide-sm" disabled={recomputing} aria-busy={recomputing}>
            {recomputing ? <span className="spinner" aria-hidden="true" /> : <Icon name="refresh" />}
            {recomputing ? 'Recomputing…' : 'Recompute scores'}
          </button>
          <form action={planAction} style={{ display: 'contents' }}>
            <span className="field">
              <label htmlFor="plan-size">Top N</label>
              <input id="plan-size" name="n" type="number" inputMode="numeric" min={1} max={30} step={1} defaultValue={5} required />
            </span>
            <button type="submit" className="btn btn-primary" disabled={creating} aria-busy={creating}>
              {creating && <span className="spinner" aria-hidden="true" />}
              {creating ? 'Creating…' : 'Create plan'}
              {!creating && <Icon name="arrow" className="arrow" />}
            </button>
          </form>
        </div>
      </section>

      {recompute.status !== 'idle' && (
        <div className={`toast ${recompute.status === 'ok' ? 'success' : 'error'}`} role={recompute.status === 'error' ? 'alert' : 'status'}>
          <Icon name={recompute.status === 'ok' ? 'check' : 'alert'} />
          <span>
            <b>{recompute.status === 'ok' ? 'Scores recomputed' : 'Could not recompute the scores'}</b>
            {recompute.message}
          </span>
        </div>
      )}
      {plan.status !== 'idle' && (
        <div className={`toast ${plan.status === 'ok' ? 'success' : 'error'}`} role={plan.status === 'error' ? 'alert' : 'status'}>
          <Icon name={plan.status === 'ok' ? 'check' : 'alert'} />
          <span>
            <b>{plan.status === 'ok' ? `Plan #${plan.planId} created` : 'No plan created'}</b>
            {plan.message} {plan.status === 'ok' && <Link href="/tasks">View tasks</Link>}
          </span>
        </div>
      )}
    </>
  );
}

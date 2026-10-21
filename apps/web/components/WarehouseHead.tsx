'use client';

import Link from 'next/link';
import { type MouseEvent, startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { type CreatePlanState, type RecomputeState, createPlanAction, recomputeScoresAction } from '../app/actions';
import { Icon } from './Icon';

// The warehouse heading with its two actions: recompute every score (D-010)
// and create a Top N plan (D-011, the API validates N). On phones the
// recompute button is an icon next to the score time; it keeps its name.
//
// Each button shows its state: working, then a check with the server's own
// result only once the server confirmed it, or an error. A recompute can
// always be retried; a plan only when nothing was created (if the answer was
// lost, the plan may exist: Tasks says). While working, the buttons stay
// focusable (aria-disabled) and ignore new presses.

// How long a confirmed result stays on the button before it reads its action
// again; the message below stays.
const RESULT_MS = 4000;

function useConfirmed(state: RecomputeState | CreatePlanState): boolean {
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (state.status !== 'ok') {
      setShown(null);
      return;
    }
    setShown(state.at);
    const timer = setTimeout(() => setShown(null), RESULT_MS);
    return () => clearTimeout(timer);
  }, [state]);
  return state.status === 'ok' && shown === state.at;
}

// The app server's own answer to an action can be lost: the outcome is then
// unknown, never an error page.
const appDidNotAnswer = () => ({
  status: 'error' as const,
  kind: 'unconfirmed' as const,
  message: 'The app did not answer. It is not known whether this was done.',
  at: Date.now(),
});

const ignoreWhile = (busy: boolean) => (event: MouseEvent) => {
  if (busy) {
    event.preventDefault();
  }
};

export function WarehouseHead({ binCount, aisleCount, scoresAsOf }: { binCount: number; aisleCount: number; scoresAsOf: string }) {
  const [recompute, recomputeAction, recomputing] = useActionState<RecomputeState>(async (previous) => {
    try {
      return await recomputeScoresAction(previous);
    } catch {
      return appDidNotAnswer();
    }
  }, { status: 'idle' });
  const [plan, planAction, creating] = useActionState<CreatePlanState, FormData>(async (previous, form) => {
    try {
      return await createPlanAction(previous, form);
    } catch {
      return appDidNotAnswer();
    }
  }, { status: 'idle' });
  const recomputed = useConfirmed(recompute);
  const planned = useConfirmed(plan);
  const [edited, setEdited] = useState(false);
  const lastPlan = useRef<FormData | null>(null);
  const planButton = useRef<HTMLButtonElement>(null);
  const recomputeButton = useRef<HTMLButtonElement>(null);

  // Set in the click itself, so a second press before the next render is
  // ignored too (aria-disabled does not stop clicks); cleared by the result.
  const retrying = useRef(false);
  useEffect(() => {
    retrying.current = false;
  }, [plan, recompute]);

  function retryPlan() {
    if (retrying.current || creating || !lastPlan.current) {
      return;
    }
    retrying.current = true;
    startTransition(() => planAction(lastPlan.current!));
    planButton.current?.focus();
  }
  function retryRecompute() {
    if (retrying.current || recomputing) {
      return;
    }
    retrying.current = true;
    startTransition(() => recomputeAction());
    recomputeButton.current?.focus();
  }

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
              aria-disabled={recomputing || undefined}
              aria-busy={recomputing}
              onClick={ignoreWhile(recomputing)}
              aria-label={recomputing ? 'Recomputing scores' : recomputed ? 'Scores recomputed' : 'Recompute scores'}
              title="Recompute scores"
            >
              <Icon name={recomputed ? 'check' : 'refresh'} className={recomputing ? 'spinning' : recomputed ? 'pop' : ''} />
            </button>
          </p>
        </div>
        <div className="actions">
          <form id="recompute-scores" action={recomputeAction} hidden />
          <button
            ref={recomputeButton}
            type="submit"
            form="recompute-scores"
            className="btn btn-outline hide-sm"
            aria-disabled={recomputing || undefined}
            aria-busy={recomputing}
            onClick={ignoreWhile(recomputing)}
          >
            {recomputing ? <span className="spinner" aria-hidden="true" /> : <Icon name={recomputed ? 'check' : 'refresh'} className={recomputed ? 'pop' : ''} />}
            {recomputing ? 'Recomputing…' : recomputed ? 'Scores recomputed' : 'Recompute scores'}
          </button>
          <form
            action={(form) => {
              lastPlan.current = form;
              setEdited(false);
              planAction(form);
            }}
            style={{ display: 'contents' }}
          >
            <span className="field">
              <label htmlFor="plan-size">Top N</label>
              <input id="plan-size" name="n" type="number" inputMode="numeric" min={1} max={30} step={1} defaultValue={5} required onChange={() => setEdited(true)} />
            </span>
            <button ref={planButton} type="submit" className="btn btn-primary" aria-disabled={creating || undefined} aria-busy={creating} onClick={ignoreWhile(creating)}>
              {creating ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Creating…
                </>
              ) : planned && plan.status === 'ok' && !edited ? (
                <>
                  <Icon name="check" className="pop" />
                  {plan.created} of {plan.requested} tasks created
                </>
              ) : (
                <>
                  Create plan
                  <Icon name="arrow" className="arrow" />
                </>
              )}
            </button>
          </form>
        </div>
      </section>

      {recompute.status !== 'idle' && (
        <div key={recompute.at} className={`toast ${recompute.status === 'ok' ? 'success' : 'error'}`} role={recompute.status === 'error' ? 'alert' : 'status'}>
          <Icon name={recompute.status === 'ok' ? 'check' : 'alert'} />
          <span>
            <b>{recompute.status === 'ok' ? 'Scores recomputed' : recompute.kind === 'unconfirmed' ? 'Recompute not confirmed' : 'Could not recompute the scores'}</b>
            {recompute.message}
            {recompute.status === 'error' && recompute.kind === 'unconfirmed' && ' Recomputing again is safe.'}
          </span>
          {recompute.status === 'error' && recompute.kind !== 'rejected' && (
            <button type="button" className="btn btn-outline btn-sm" onClick={retryRecompute} aria-disabled={recomputing || undefined}>
              Retry
            </button>
          )}
        </div>
      )}
      {plan.status !== 'idle' && (
        <div key={plan.at} className={`toast ${plan.status === 'ok' ? 'success' : plan.kind === 'unconfirmed' ? 'info' : 'error'}`} role={plan.status === 'error' ? 'alert' : 'status'}>
          <Icon name={plan.status === 'ok' ? 'check' : 'alert'} />
          <span>
            <b>{plan.status === 'ok' ? `Plan #${plan.planId} created` : plan.kind === 'unconfirmed' ? 'Plan not confirmed' : 'No plan created'}</b>
            {plan.message} {plan.status === 'ok' && <Link href="/tasks">View tasks</Link>}
            {plan.status === 'error' && plan.kind === 'unconfirmed' && (
              <>
                {' '}
                It may have been created: <Link href="/tasks">check Tasks</Link> before creating another.
              </>
            )}
          </span>
          {plan.status === 'error' && plan.kind === 'failed' && (
            <button type="button" className="btn btn-outline btn-sm" onClick={retryPlan} aria-disabled={creating || undefined}>
              Retry
            </button>
          )}
        </div>
      )}
    </>
  );
}

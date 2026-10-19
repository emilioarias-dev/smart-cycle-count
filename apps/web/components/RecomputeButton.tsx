'use client';

import { useActionState } from 'react';
import { type RecomputeState, recomputeScoresAction } from '../app/actions';

// Recomputes every score for the current time. Either all scores are saved or
// none (the API does it in one transaction).
export function RecomputeButton() {
  const [state, action, pending] = useActionState<RecomputeState>(recomputeScoresAction, { status: 'idle' });

  return (
    <form action={action} className="recompute">
      <button type="submit" disabled={pending}>
        {pending ? 'Recomputing…' : 'Recompute scores'}
      </button>
      {state.status !== 'idle' && (
        <p className={`action-result ${state.status}`} role={state.status === 'error' ? 'alert' : 'status'}>
          {state.message}
        </p>
      )}
    </form>
  );
}

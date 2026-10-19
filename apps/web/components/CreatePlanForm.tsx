'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { type CreatePlanState, createPlanAction } from '../app/actions';

// "Create plan → Top N risky bins" (D-011). The API validates N.
export function CreatePlanForm() {
  const [state, action, pending] = useActionState<CreatePlanState, FormData>(createPlanAction, { status: 'idle' });

  return (
    <form action={action} className="create-plan">
      <label htmlFor="plan-size">Top N</label>
      <input id="plan-size" name="n" type="number" inputMode="numeric" min={1} max={30} step={1} defaultValue={5} required />
      <button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create plan'}
      </button>
      {state.status !== 'idle' && (
        <p className={`action-result ${state.status}`} role={state.status === 'error' ? 'alert' : 'status'}>
          {state.message}{' '}
          {state.status === 'ok' && <Link href="/tasks">View tasks</Link>}
        </p>
      )}
    </form>
  );
}

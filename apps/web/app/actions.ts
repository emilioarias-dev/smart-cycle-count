'use server';

import { refresh } from 'next/cache';
import { type CountOutcome, type CountPayload, type ErrorKind, type RivyExchange, type RivyOutcome, askRivy, createPlan, recomputeScores, submitCount } from '../lib/api';

// `at` tells two equal results apart, so each one is announced.
export type RecomputeState =
  | { status: 'idle' }
  | { status: 'ok'; message: string; at: number }
  | { status: 'error'; message: string; kind: ErrorKind; at: number };

// Runs on the Next.js server: asks the API to recompute every score for the
// current time, then refreshes the page so the grid shows the new scores.
export async function recomputeScoresAction(_previous: RecomputeState): Promise<RecomputeState> {
  const result = await recomputeScores();
  if (result.status !== 'ok') {
    return {
      status: 'error',
      kind: result.status === 'error' ? (result.kind ?? 'failed') : 'failed',
      message: result.status === 'error' ? result.reason : 'The API has no recompute endpoint (404).',
      at: Date.now(),
    };
  }
  refresh();
  const { bins, byPriority } = result.data;
  return {
    status: 'ok',
    message: `${bins} bins: ${byPriority.high} high, ${byPriority.medium} medium, ${byPriority.low} low priority.`,
    at: Date.now(),
  };
}

export type CreatePlanState =
  | { status: 'idle' }
  | { status: 'ok'; message: string; planId: number; created: number; requested: number; at: number }
  | { status: 'error'; message: string; kind: ErrorKind; at: number };

// Creates a Top N plan through the API. The text typed by the user is sent
// as a number only if it is a whole number; anything else is sent as typed so
// the API rejects it with its own message.
export async function createPlanAction(_previous: CreatePlanState, formData: FormData): Promise<CreatePlanState> {
  const raw = String(formData.get('n') ?? '').trim();
  const n = /^-?\d+$/.test(raw) ? Number(raw) : raw;
  const result = await createPlan(n);
  if (result.status !== 'ok') {
    return {
      status: 'error',
      kind: result.status === 'error' ? (result.kind ?? 'failed') : 'failed',
      message: result.status === 'error' ? result.reason : 'The API has no plans endpoint (404).',
      at: Date.now(),
    };
  }
  refresh();
  const { plan } = result.data;
  const skipped = [
    plan.excluded.pendingTask > 0 ? `${plan.excluded.pendingTask} with a pending task` : null,
    plan.excluded.noScore > 0 ? `${plan.excluded.noScore} without a score` : null,
  ].filter(Boolean);
  return {
    status: 'ok',
    planId: plan.id,
    created: plan.createdCount,
    requested: plan.requestedCount,
    at: Date.now(),
    message:
      `${plan.createdCount} of ${plan.requestedCount} requested tasks created.` +
      (skipped.length > 0 ? ` Skipped: ${skipped.join(', ')}.` : ''),
  };
}

// Submits a count for its task (D-012). The page is not refreshed: the form
// shows the outcome, and the task is no longer pending once saved.
export async function submitCountAction(taskId: number, payload: CountPayload): Promise<CountOutcome> {
  return submitCount(taskId, payload);
}

// Asks Rivy (read-only). The conversation lives in the browser; it is sent
// with each question and never stored.
export async function askRivyAction(question: string, history: RivyExchange[]): Promise<RivyOutcome> {
  return askRivy(question, history);
}

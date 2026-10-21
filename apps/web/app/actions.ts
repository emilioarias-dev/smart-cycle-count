'use server';

import { refresh } from 'next/cache';
import {
  type CountOutcome,
  type CountPayload,
  type CreatedPlan,
  type ErrorKind,
  createPlan,
  recomputeScores,
  submitCount,
} from '../lib/api';

// `at` tells two equal results apart, so each one is announced.
export type RecomputeState =
  | { status: 'idle' }
  | { status: 'ok'; message: string; at: number }
  | { status: 'error'; message: string; kind: ErrorKind; at: number };

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

// A write whose outcome is unknown. If the API answered (an error status or an
// incomplete body), the page is refreshed so it shows what the API has now; if
// it did not answer, the page is kept as it is, with the message.
function notConfirmed(message: string, responded: boolean): { status: 'error'; message: string; kind: ErrorKind; at: number } {
  if (responded) {
    refresh();
  }
  return { status: 'error', kind: 'unconfirmed', message, at: Date.now() };
}

// Runs on the Next.js server: asks the API to recompute every score for the
// current time, then refreshes the page so the grid shows the new scores.
export async function recomputeScoresAction(_previous: RecomputeState): Promise<RecomputeState> {
  const result = await recomputeScores();
  if (result.status === 'error' && result.kind === 'unconfirmed') {
    return notConfirmed(result.reason, result.responded === true);
  }
  if (result.status !== 'ok') {
    return {
      status: 'error',
      kind: result.status === 'error' ? (result.kind ?? 'failed') : 'failed',
      message: result.status === 'error' ? result.reason : 'The API has no recompute endpoint (404).',
      at: Date.now(),
    };
  }
  // A success whose body lacks the summary is not shown as a confirmed result.
  const summary = result.data as Partial<typeof result.data> | null;
  if (!summary || !isCount(summary.bins) || !summary.byPriority || ![summary.byPriority.high, summary.byPriority.medium, summary.byPriority.low].every(isCount)) {
    return notConfirmed("The API's answer was incomplete. It is not known whether this was done.", true);
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
  if (result.status === 'error' && result.kind === 'unconfirmed') {
    return notConfirmed(result.reason, result.responded === true);
  }
  if (result.status !== 'ok') {
    return {
      status: 'error',
      kind: result.status === 'error' ? (result.kind ?? 'failed') : 'failed',
      message: result.status === 'error' ? result.reason : 'The API has no plans endpoint (404).',
      at: Date.now(),
    };
  }
  // A success whose body lacks the plan's counts is not a confirmed result.
  const plan = (result.data as { plan?: Partial<CreatedPlan['plan']> } | null)?.plan;
  if (!plan || !isCount(plan.id) || !isCount(plan.createdCount) || !isCount(plan.requestedCount) || !plan.excluded || !isCount(plan.excluded.pendingTask) || !isCount(plan.excluded.noScore)) {
    return notConfirmed("The API's answer was incomplete. It is not known whether this was done.", true);
  }
  refresh();
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

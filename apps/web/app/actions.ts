'use server';

import { refresh } from 'next/cache';
import { recomputeScores } from '../lib/api';

export type RecomputeState = { status: 'idle' } | { status: 'ok'; message: string } | { status: 'error'; message: string };

// Runs on the Next.js server: asks the API to recompute every score for the
// current time, then refreshes the page so the grid shows the new scores.
export async function recomputeScoresAction(_previous: RecomputeState): Promise<RecomputeState> {
  const result = await recomputeScores();
  if (result.status !== 'ok') {
    return {
      status: 'error',
      message: result.status === 'error' ? result.reason : 'The API has no recompute endpoint (404).',
    };
  }
  refresh();
  const { bins, byPriority } = result.data;
  return {
    status: 'ok',
    message: `Recomputed ${bins} bins: ${byPriority.high} high, ${byPriority.medium} medium, ${byPriority.low} low priority.`,
  };
}

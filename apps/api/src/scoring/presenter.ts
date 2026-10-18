import type { BinScore } from '../generated/prisma/client.js';
import { PRIORITY_LABEL, type Priority, type ScoreBreakdown, priorityFor } from './formula.js';

// How a stored score is returned by the API: the number with its priority
// band and label (D-010), so the web never re-implements the bands.

export type ScoreSummary = { value: number; priority: Priority; label: string; reference: Date };
export type ScoreDetail = ScoreSummary & { computedAt: Date; formulaVersion: number; breakdown: ScoreBreakdown };

export function scoreSummary(score: BinScore | null): ScoreSummary | null {
  if (!score) {
    return null;
  }
  const priority = priorityFor(score.score);
  return { value: score.score, priority, label: PRIORITY_LABEL[priority], reference: score.referenceAt };
}

export function scoreDetail(score: BinScore | null): ScoreDetail | null {
  const summary = scoreSummary(score);
  if (!summary || !score) {
    return null;
  }
  return {
    ...summary,
    computedAt: score.computedAt,
    formulaVersion: score.formulaVersion,
    breakdown: score.breakdown as unknown as ScoreBreakdown,
  };
}

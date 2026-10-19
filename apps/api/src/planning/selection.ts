import type { ScoreBreakdown } from '../scoring/formula.js';

// Which bins go into a Top N plan, and in which order (D-011). Pure: no
// database, no clock. createPlan applies it to the current state.

export const PLAN_SIZE = { min: 1, max: 30, default: 5 } as const;

export type PlanErrorCode = 'INVALID_N' | 'NO_SCORES' | 'NO_AVAILABLE_BINS';

export class PlanError extends Error {
  constructor(
    readonly code: PlanErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PlanError';
  }
}

export type PlanCandidate = {
  binId: number;
  code: string;
  hasPendingTask: boolean;
  // The stored score with its breakdown, or null if the bin was never scored.
  score: { value: number; breakdown: ScoreBreakdown } | null;
};

export type ScoredCandidate = PlanCandidate & { score: NonNullable<PlanCandidate['score']> };

export type PlanSelection = {
  selected: ScoredCandidate[];
  excluded: { pendingTask: number; noScore: number };
};

// N must be an integer from 1 to 30; when it is missing, the default (5).
export function parsePlanSize(value: unknown): number {
  if (value === undefined) {
    return PLAN_SIZE.default;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < PLAN_SIZE.min || value > PLAN_SIZE.max) {
    throw new PlanError('INVALID_N', `N must be an integer from ${PLAN_SIZE.min} to ${PLAN_SIZE.max}.`);
  }
  return value;
}

export function selectForPlan(candidates: PlanCandidate[], n: number): PlanSelection {
  if (!candidates.some((c) => c.score !== null)) {
    throw new PlanError('NO_SCORES', 'No bin has a score: recompute the scores first.');
  }
  // A bin with a pending task is excluded for that reason, scored or not.
  const pendingTask = candidates.filter((c) => c.hasPendingTask).length;
  const noScore = candidates.filter((c) => !c.hasPendingTask && c.score === null).length;
  const eligible = candidates.filter((c): c is ScoredCandidate => !c.hasPendingTask && c.score !== null);
  if (eligible.length === 0) {
    throw new PlanError('NO_AVAILABLE_BINS', 'No bins are available: every scored bin already has a pending task.');
  }
  return { selected: [...eligible].sort(comparePriority).slice(0, n), excluded: { pendingTask, noScore } };
}

// Score descending; then never audited first and the oldest audit; then code.
// The audit information is the one stored in the score breakdown, so the
// order matches the explanation the task keeps.
export function comparePriority(a: ScoredCandidate, b: ScoredCandidate): number {
  return b.score.value - a.score.value || auditOrder(a) - auditOrder(b) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
}

function auditOrder(candidate: ScoredCandidate): number {
  const age = candidate.score.breakdown.factors.age;
  return age.neverAudited || age.lastAuditedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(age.lastAuditedAt);
}

// The risk score formula (D-010, version 2 from D-012). Pure: no database, no
// clock. This is the
// only implementation of the score; everything else calls it.
//
// The score is a heuristic priority for audits, not a probability of error.

export const FORMULA_VERSION = 2;
export const WINDOW_DAYS = 30;

export const WEIGHTS = { age: 30, activity: 25, adjustments: 20, lastResult: 25 } as const;
export const CAPS = { ageDays: 90, activity: 40, adjustments: 5 } as const;

const DAY = 86_400_000;

export type ScoreInputs = {
  lastAuditedAt: Date | null;
  // PUTAWAY, PICK and MOVE movements in the window that touch the bin.
  activity: number;
  // ADJUSTMENT movements in the window in the bin.
  adjustments: number;
  // The latest count up to the reference, or null if the bin was never
  // counted (unknown, not PASS).
  lastCount: { result: CountResult; countedAt: Date } | null;
};

export type CountResult = 'PASS' | 'FAIL';

export type Priority = 'low' | 'medium' | 'high';

export type FactorBreakdown = {
  weight: number;
  cap: number;
  input: number;
  factor: number;
  contribution: number;
};

// 1 if the latest count failed; 0 if it passed or there is none (unknown).
export type LastResultBreakdown = {
  weight: number;
  result: CountResult | null;
  countedAt: string | null;
  factor: 0 | 1;
  contribution: number;
};

export type ScoreBreakdown = {
  formulaVersion: number;
  reference: string;
  window: { from: string; to: string; fromExclusive: true };
  factors: {
    age: FactorBreakdown & { lastAuditedAt: string | null; neverAudited: boolean };
    activity: FactorBreakdown;
    adjustments: FactorBreakdown;
    // Absent in breakdowns of formula version 1 (task copies made before
    // milestone 5).
    lastResult?: LastResultBreakdown;
  };
  // Sum of the unrounded contributions; the score rounds it once.
  total: number;
  score: number;
};

// The window is (reference − 30 days, reference]: start excluded, end included.
export function scoreWindow(reference: Date): { from: Date; to: Date } {
  return { from: new Date(reference.getTime() - WINDOW_DAYS * DAY), to: reference };
}

export function computeScore(inputs: ScoreInputs, reference: Date): ScoreBreakdown {
  const neverAudited = inputs.lastAuditedAt === null;
  // An audit recorded after the reference counts as age 0, never negative.
  const ageDays = neverAudited ? CAPS.ageDays : Math.max(0, (reference.getTime() - inputs.lastAuditedAt!.getTime()) / DAY);

  const age = factor(WEIGHTS.age, CAPS.ageDays, ageDays);
  const activity = factor(WEIGHTS.activity, CAPS.activity, inputs.activity);
  const adjustments = factor(WEIGHTS.adjustments, CAPS.adjustments, inputs.adjustments);
  const failed = inputs.lastCount?.result === 'FAIL' ? 1 : 0;
  const lastResult: LastResultBreakdown = {
    weight: WEIGHTS.lastResult,
    result: inputs.lastCount?.result ?? null,
    countedAt: inputs.lastCount?.countedAt.toISOString() ?? null,
    factor: failed,
    contribution: WEIGHTS.lastResult * failed,
  };
  const total = age.contribution + activity.contribution + adjustments.contribution + lastResult.contribution;
  const window = scoreWindow(reference);

  return {
    formulaVersion: FORMULA_VERSION,
    reference: reference.toISOString(),
    window: { from: window.from.toISOString(), to: window.to.toISOString(), fromExclusive: true },
    factors: {
      age: { ...age, lastAuditedAt: inputs.lastAuditedAt?.toISOString() ?? null, neverAudited },
      activity,
      adjustments,
      lastResult,
    },
    total,
    // Rounded once, at the end: half up (scores are never negative).
    score: Math.round(total),
  };
}

export function priorityFor(score: number): Priority {
  return score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low priority',
  medium: 'Medium priority',
  high: 'High priority',
};

// min(input / cap, 1), contributing weight × factor. Computed as
// weight × min(input, cap) / cap so that integer inputs give exact values.
function factor(weight: number, cap: number, input: number): FactorBreakdown {
  const capped = Math.min(input, cap);
  return { weight, cap, input, factor: capped / cap, contribution: (weight * capped) / cap };
}

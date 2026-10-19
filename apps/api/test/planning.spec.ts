import { computeScore } from '../src/scoring/formula.js';
import { type PlanCandidate, parsePlanSize, selectForPlan } from '../src/planning/selection.js';

// Top N selection without a database (D-011).
const R = new Date('2026-10-18T12:00:00Z');
const DAY = 86_400_000;

// A candidate whose stored breakdown says when the bin was last audited.
function candidate(code: string, value: number | null, auditedDaysBefore: number | null = null, hasPendingTask = false): PlanCandidate {
  const lastAuditedAt = auditedDaysBefore === null ? null : new Date(R.getTime() - auditedDaysBefore * DAY);
  return {
    binId: code.charCodeAt(code.length - 1),
    code,
    hasPendingTask,
    score: value === null ? null : { value, breakdown: { ...computeScore({ lastAuditedAt, activity: 0, adjustments: 0 }, R), score: value } },
  };
}
const codes = (selection: ReturnType<typeof selectForPlan>) => selection.selected.map((c) => c.code);

describe('parsePlanSize', () => {
  it('accepts integers from 1 to 30 and defaults to 5', () => {
    expect([1, 5, 30].map(parsePlanSize)).toEqual([1, 5, 30]);
    expect(parsePlanSize(undefined)).toBe(5);
  });

  it('rejects anything else, including numbers as text', () => {
    for (const value of [0, 31, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, '5', null, true, [5], {}]) {
      expect(() => parsePlanSize(value)).toThrow(expect.objectContaining({ name: 'PlanError', code: 'INVALID_N' }));
    }
  });
});

describe('selectForPlan', () => {
  it('orders by score, then never audited first, then the oldest audit, then code', () => {
    const selection = selectForPlan(
      [
        candidate('A-01-01', 77, 10),
        candidate('A-01-02', 77, 80),
        candidate('A-01-04', 77, null),
        candidate('A-01-03', 77, null),
        candidate('A-01-05', 90, 1),
        candidate('B-01-01', 12, 3),
      ],
      30,
    );
    expect(codes(selection)).toEqual(['A-01-05', 'A-01-03', 'A-01-04', 'A-01-02', 'A-01-01', 'B-01-01']);
  });

  it('breaks a tie at the N boundary with the same rules', () => {
    const selection = selectForPlan([candidate('A-02-01', 77, 83), candidate('B-01-05', 77, null), candidate('B-02-03', 91, 84)], 2);
    expect(codes(selection)).toEqual(['B-02-03', 'B-01-05']);
  });

  it('treats a score of 0 as a score and excludes bins without one', () => {
    const selection = selectForPlan([candidate('A-01-01', 0, 1), candidate('A-01-02', null), candidate('A-01-03', 40, 5)], 5);
    expect(codes(selection)).toEqual(['A-01-03', 'A-01-01']);
    expect(selection.excluded).toEqual({ pendingTask: 0, noScore: 1 });
  });

  it('excludes bins with a pending task and counts each bin under one reason', () => {
    const selection = selectForPlan(
      [candidate('A-01-01', 90, 1, true), candidate('A-01-02', null, null, true), candidate('A-01-03', 50, 1), candidate('A-01-04', null)],
      5,
    );
    expect(codes(selection)).toEqual(['A-01-03']);
    expect(selection.excluded).toEqual({ pendingTask: 2, noScore: 1 });
  });

  it('creates fewer than N when fewer are eligible', () => {
    expect(selectForPlan([candidate('A-01-01', 10, 1), candidate('A-01-02', 20, 1)], 5).selected).toHaveLength(2);
  });

  it('distinguishes "no scores" from "no bins available"', () => {
    expect(() => selectForPlan([candidate('A-01-01', null), candidate('A-01-02', null)], 5)).toThrow(
      expect.objectContaining({ code: 'NO_SCORES' }),
    );
    expect(() => selectForPlan([candidate('A-01-01', 50, 1, true), candidate('A-01-02', null)], 5)).toThrow(
      expect.objectContaining({ code: 'NO_AVAILABLE_BINS' }),
    );
    expect(() => selectForPlan([], 5)).toThrow(expect.objectContaining({ code: 'NO_SCORES' }));
  });
});

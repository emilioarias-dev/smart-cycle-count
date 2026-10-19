import { CAPS, type CountResult, FORMULA_VERSION, WEIGHTS, computeScore, priorityFor, scoreWindow } from '../src/scoring/formula.js';

// The score formula without a database (D-010, version 2 from D-012).
const DAY = 86_400_000;
const reference = new Date('2026-10-18T12:00:00Z');
const daysBefore = (days: number) => new Date(reference.getTime() - days * DAY);
const score = (lastAuditedAt: Date | null, activity: number, adjustments: number, last: CountResult | null = null) =>
  computeScore(
    { lastAuditedAt, activity, adjustments, lastCount: last === null ? null : { result: last, countedAt: daysBefore(2) } },
    reference,
  );

describe('computeScore', () => {
  it('is version 2: weights 30 / 25 / 20 / 25; caps 90 days / 40 movements / 5 adjustments', () => {
    expect(FORMULA_VERSION).toBe(2);
    expect(WEIGHTS).toEqual({ age: 30, activity: 25, adjustments: 20, lastResult: 25 });
    expect(CAPS).toEqual({ ageDays: 90, activity: 40, adjustments: 5 });
  });

  it('a never-audited bin gets the maximum age contribution', () => {
    const result = score(null, 0, 0);
    expect(result.factors.age).toMatchObject({ neverAudited: true, factor: 1, contribution: 30 });
    expect(result.score).toBe(30);
  });

  it('each factor reaches 1 at its cap and stays there beyond it', () => {
    expect(score(daysBefore(90), 0, 0).factors.age.contribution).toBe(30);
    expect(score(daysBefore(200), 0, 0).factors.age.contribution).toBe(30);
    expect(score(reference, 40, 0).factors.activity.contribution).toBe(25);
    expect(score(reference, 55, 0).factors.activity.contribution).toBe(25);
    expect(score(reference, 0, 5).factors.adjustments.contribution).toBe(20);
    expect(score(reference, 0, 9).factors.adjustments.contribution).toBe(20);
    expect(score(null, 40, 5).score).toBe(75);
    expect(score(null, 40, 5, 'FAIL').score).toBe(100);
  });

  it('below the caps each factor is proportional', () => {
    const result = score(daysBefore(45), 10, 1);
    expect(result.factors.age.contribution).toBe(15);
    expect(result.factors.activity.contribution).toBe(6.25);
    expect(result.factors.adjustments.contribution).toBe(4);
    expect(result.total).toBe(25.25);
    expect(result.score).toBe(25);
  });

  it('the last result: FAIL adds 25; PASS and no count (unknown) add 0', () => {
    expect(score(daysBefore(45), 10, 1, 'FAIL').factors.lastResult).toEqual({
      weight: 25,
      result: 'FAIL',
      countedAt: daysBefore(2).toISOString(),
      factor: 1,
      contribution: 25,
    });
    expect(score(daysBefore(45), 10, 1, 'FAIL').score).toBe(50);
    expect(score(daysBefore(45), 10, 1, 'PASS').factors.lastResult).toMatchObject({ result: 'PASS', factor: 0, contribution: 0 });
    expect(score(daysBefore(45), 10, 1, 'PASS').score).toBe(25);
    // Unknown is recorded as such, not as PASS.
    expect(score(daysBefore(45), 10, 1).factors.lastResult).toEqual({ weight: 25, result: null, countedAt: null, factor: 0, contribution: 0 });
  });

  it('an audit at or after the reference gives age 0, never negative', () => {
    expect(score(reference, 0, 0).score).toBe(0);
    expect(score(new Date(reference.getTime() + DAY), 0, 0).factors.age.contribution).toBe(0);
  });

  it('rounds once, at the end, half up', () => {
    // 2.5 → 3 (half up); 10.5 → 11.
    expect(score(reference, 4, 0)).toMatchObject({ total: 2.5, score: 3 });
    expect(score(reference, 2, 2)).toMatchObject({ total: 9.25, score: 9 });
    expect(score(reference, 4, 2)).toMatchObject({ total: 10.5, score: 11 });
    // 0.5 + 0.625 = 1.125 → 1. Rounding each contribution first would give
    // 1 + 1 = 2.
    const once = score(daysBefore(1.5), 1, 0);
    expect(once.factors.age.contribution).toBeCloseTo(0.5, 10);
    expect(once.total).toBeCloseTo(1.125, 10);
    expect(once.score).toBe(1);
  });

  it('stores what is needed to reproduce the score', () => {
    const result = score(daysBefore(30), 12, 2, 'FAIL');
    const { age, activity, adjustments, lastResult } = result.factors;
    expect(result).toMatchObject({
      formulaVersion: 2,
      reference: '2026-10-18T12:00:00.000Z',
      window: { from: '2026-09-18T12:00:00.000Z', to: '2026-10-18T12:00:00.000Z', fromExclusive: true },
    });
    expect(age).toMatchObject({ weight: 30, cap: 90, input: 30, lastAuditedAt: '2026-09-18T12:00:00.000Z' });
    expect(activity).toMatchObject({ weight: 25, cap: 40, input: 12 });
    expect(adjustments).toMatchObject({ weight: 20, cap: 5, input: 2 });
    expect(lastResult).toMatchObject({ weight: 25, result: 'FAIL', countedAt: '2026-10-16T12:00:00.000Z' });
    expect(result.total).toBe(age.contribution + activity.contribution + adjustments.contribution + lastResult!.contribution);
  });
});

describe('scoreWindow', () => {
  it('is (reference − 30 days, reference]', () => {
    expect(scoreWindow(reference)).toEqual({ from: daysBefore(30), to: reference });
  });
});

describe('priorityFor', () => {
  it('bands: 0–39 low, 40–69 medium, 70–100 high', () => {
    expect([0, 39, 40, 69, 70, 100].map(priorityFor)).toEqual(['low', 'low', 'medium', 'medium', 'high', 'high']);
  });
});

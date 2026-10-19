import { CAPS, WEIGHTS, computeScore, priorityFor, scoreWindow } from '../src/scoring/formula.js';

// The score formula without a database (D-010).
const DAY = 86_400_000;
const reference = new Date('2026-10-18T12:00:00Z');
const daysBefore = (days: number) => new Date(reference.getTime() - days * DAY);
const score = (lastAuditedAt: Date | null, activity: number, adjustments: number) =>
  computeScore({ lastAuditedAt, activity, adjustments }, reference);

describe('computeScore', () => {
  it('uses weights 40 / 35 / 25 and caps 90 days / 40 movements / 5 adjustments', () => {
    expect(WEIGHTS).toEqual({ age: 40, activity: 35, adjustments: 25 });
    expect(CAPS).toEqual({ ageDays: 90, activity: 40, adjustments: 5 });
  });

  it('a never-audited bin gets the maximum age contribution', () => {
    const result = score(null, 0, 0);
    expect(result.factors.age).toMatchObject({ neverAudited: true, factor: 1, contribution: 40 });
    expect(result.score).toBe(40);
  });

  it('each factor reaches 1 at its cap and stays there beyond it', () => {
    expect(score(daysBefore(90), 0, 0).factors.age.contribution).toBe(40);
    expect(score(daysBefore(200), 0, 0).factors.age.contribution).toBe(40);
    expect(score(reference, 40, 0).factors.activity.contribution).toBe(35);
    expect(score(reference, 55, 0).factors.activity.contribution).toBe(35);
    expect(score(reference, 0, 5).factors.adjustments.contribution).toBe(25);
    expect(score(reference, 0, 9).factors.adjustments.contribution).toBe(25);
    expect(score(null, 40, 5).score).toBe(100);
  });

  it('below the caps each factor is proportional', () => {
    const result = score(daysBefore(45), 10, 1);
    expect(result.factors.age.contribution).toBe(20);
    expect(result.factors.activity.contribution).toBe(8.75);
    expect(result.factors.adjustments.contribution).toBe(5);
    expect(result.total).toBe(33.75);
    expect(result.score).toBe(34);
  });

  it('an audit at or after the reference gives age 0, never negative', () => {
    expect(score(reference, 0, 0).score).toBe(0);
    expect(score(new Date(reference.getTime() + DAY), 0, 0).factors.age.contribution).toBe(0);
  });

  it('rounds once, at the end, half up', () => {
    // 3.5 → 4 (half up); 13.5 → 14.
    expect(score(reference, 4, 0)).toMatchObject({ total: 3.5, score: 4 });
    expect(score(reference, 4, 2)).toMatchObject({ total: 13.5, score: 14 });
    // 0.6 + 0.875 = 1.475 → 1. Rounding each contribution first would give 2.
    const once = score(daysBefore(1.35), 1, 0);
    expect(once.factors.age.contribution).toBeCloseTo(0.6, 10);
    expect(once.total).toBeCloseTo(1.475, 10);
    expect(once.score).toBe(1);
  });

  it('stores what is needed to reproduce the score', () => {
    const result = score(daysBefore(30), 12, 2);
    const { age, activity, adjustments } = result.factors;
    expect(result).toMatchObject({
      formulaVersion: 1,
      reference: '2026-10-18T12:00:00.000Z',
      window: { from: '2026-09-18T12:00:00.000Z', to: '2026-10-18T12:00:00.000Z', fromExclusive: true },
    });
    expect(age).toMatchObject({ weight: 40, cap: 90, input: 30, lastAuditedAt: '2026-09-18T12:00:00.000Z' });
    expect(activity).toMatchObject({ weight: 35, cap: 40, input: 12 });
    expect(adjustments).toMatchObject({ weight: 25, cap: 5, input: 2 });
    expect(result.total).toBe(age.contribution + activity.contribution + adjustments.contribution);
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

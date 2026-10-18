import { ACTIVITY_DAYS, OPENING_STOCK_DAYS, generateDemoData } from '../src/demo-data/generate.js';
import { resolveReference } from '../src/demo-data/reference.js';
import { FIXED_REFERENCE } from './support.js';

// The demo data generator, without a database (D-009).
const DAY = 86_400_000;

describe('resolveReference', () => {
  it('accepts date-times with an explicit zone', () => {
    expect(resolveReference('2026-10-18T12:00:00Z').toISOString()).toBe('2026-10-18T12:00:00.000Z');
    expect(resolveReference('2026-10-18T08:00:00-04:00').toISOString()).toBe('2026-10-18T12:00:00.000Z');
  });

  it('rejects values without an explicit zone or that are not dates', () => {
    expect(() => resolveReference('2026-10-18T12:00:00')).toThrow(/explicit zone/);
    expect(() => resolveReference('2026-10-18')).toThrow(/explicit zone/);
    expect(() => resolveReference('2026-13-45T99:00:00Z')).toThrow(/not a valid/);
  });

  it('without SEED_NOW, captures the current time once, in whole seconds', () => {
    const reference = resolveReference(undefined, () => new Date('2026-10-18T12:34:56.789Z'));
    expect(reference.toISOString()).toBe('2026-10-18T12:34:56.000Z');
  });
});

describe('generateDemoData', () => {
  const data = generateDemoData({ reference: FIXED_REFERENCE });
  const times = data.movements.map((m) => m.occurredAt.getTime());
  const ref = FIXED_REFERENCE.getTime();

  it('is reproducible: same version, seed and reference give the same data', () => {
    expect(generateDemoData({ reference: new Date(FIXED_REFERENCE) })).toEqual(data);
  });

  it('a different seed gives different data', () => {
    expect(generateDemoData({ reference: FIXED_REFERENCE, seed: 1 }).movements).not.toEqual(data.movements);
  });

  it('a later reference shifts every date and changes nothing else', () => {
    const later = generateDemoData({ reference: new Date(ref + DAY) });
    const shift = <T extends { occurredAt: Date }>(m: T) => ({ ...m, occurredAt: new Date(m.occurredAt.getTime() + DAY) });
    expect(later.movements).toEqual(data.movements.map(shift));
    expect(later.bins.map((b) => b.lastAuditedAt?.getTime() ?? null)).toEqual(
      data.bins.map((b) => (b.lastAuditedAt ? b.lastAuditedAt.getTime() + DAY : null)),
    );
  });

  it('has the fixed layout: 30 bins in 3 aisles × 2 racks × 5 positions', () => {
    expect(data.bins).toHaveLength(30);
    expect(new Set(data.bins.map((b) => b.code)).size).toBe(30);
    expect(data.bins.slice(0, 6).map((b) => b.code)).toEqual(['A-01-01', 'A-01-02', 'A-01-03', 'A-01-04', 'A-01-05', 'A-02-01']);
    expect(data.bins.at(-1)?.code).toBe('C-02-05');
  });

  it('has no event at or after the reference, and events are in chronological order', () => {
    expect(Math.max(...times)).toBeLessThan(ref);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('separates opening stock (60 to 30 days before) from the last 30 days of activity', () => {
    const activityStart = ref - ACTIVITY_DAYS * DAY;
    const opening = data.movements.filter((m) => m.occurredAt.getTime() < activityStart);
    const activity = data.movements.filter((m) => m.occurredAt.getTime() >= activityStart);
    expect(opening.length).toBeGreaterThan(0);
    expect(opening.every((m) => m.type === 'PUTAWAY')).toBe(true);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(ref - OPENING_STOCK_DAYS * DAY);
    expect(new Set(activity.map((m) => m.type))).toEqual(new Set(['PUTAWAY', 'PICK', 'MOVE', 'ADJUSTMENT']));
  });

  it('simulates audit antecedents: never audited, or 2 to 90 days before the reference', () => {
    const audited = data.bins.filter((b) => b.lastAuditedAt !== null);
    expect(audited.length).toBeGreaterThan(0);
    expect(audited.length).toBeLessThan(30);
    for (const bin of audited) {
      const daysBefore = (ref - bin.lastAuditedAt!.getTime()) / DAY;
      expect(daysBefore).toBeGreaterThanOrEqual(2);
      expect(daysBefore).toBeLessThanOrEqual(90);
    }
  });
});

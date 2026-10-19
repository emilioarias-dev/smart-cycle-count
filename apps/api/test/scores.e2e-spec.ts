import { applyMovement } from '../src/inventory/movements.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { ScoreBreakdown } from '../src/scoring/formula.js';
import { recomputeScores } from '../src/scoring/recompute.js';
import { businessSnapshot, clearInventory, scoresInSql } from './support.js';

// Score inputs and storage against the real PostgreSQL test database (D-010).
describe('Score recompute (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const DAY = 86_400_000;
  const R = new Date('2026-10-18T12:00:00Z');
  const at = (ms: number) => new Date(R.getTime() + ms);

  const breakdownOf = async (code: string) => {
    const bin = await prisma.bin.findUniqueOrThrow({ where: { code }, include: { score: true } });
    return bin.score!.breakdown as unknown as ScoreBreakdown;
  };

  beforeEach(async () => {
    await clearInventory(prisma);
    await prisma.product.create({ data: { sku: 'SKU-T1', name: 'Test product', unit: 'case' } });
    await prisma.bin.createMany({
      data: [
        { code: 'A-01-01', aisle: 'A', rack: 1, position: 1, lastAuditedAt: new Date(R.getTime() - 45 * DAY) },
        { code: 'A-01-02', aisle: 'A', rack: 1, position: 2 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_score_insert ON bin_scores');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_score_insert()');
    await prisma.$disconnect();
  });

  it('counts movements in (reference − 30 days, reference], once per affected bin', async () => {
    const move = (input: Parameters<typeof applyMovement>[1]) => applyMovement(prisma, input);
    // A-01-01: putaway before the window, a pick exactly at its excluded start,
    // a pick 1 ms later (counted) and a move at the reference (counted, end included).
    await move({ type: 'PUTAWAY', palletCode: 'P-1', productSku: 'SKU-T1', binCode: 'A-01-01', quantity: 40, occurredAt: at(-40 * DAY) });
    await move({ type: 'PICK', palletCode: 'P-1', quantity: 1, occurredAt: at(-30 * DAY) });
    await move({ type: 'PICK', palletCode: 'P-1', quantity: 1, occurredAt: at(-30 * DAY + 1) });
    // A-01-02: a putaway and an adjustment inside the window, the move's
    // destination, and an adjustment 1 ms after the reference (not counted).
    await move({ type: 'PUTAWAY', palletCode: 'P-2', productSku: 'SKU-T1', binCode: 'A-01-02', quantity: 10, occurredAt: at(-2 * DAY) });
    await move({ type: 'ADJUSTMENT', palletCode: 'P-2', delta: -1, occurredAt: at(-DAY) });
    await move({ type: 'MOVE', palletCode: 'P-1', toBinCode: 'A-01-02', occurredAt: R });
    await move({ type: 'ADJUSTMENT', palletCode: 'P-2', delta: -1, occurredAt: at(1) });

    const summary = await recomputeScores(prisma, R);
    expect(summary.bins).toBe(2);

    const first = await breakdownOf('A-01-01');
    expect(first.factors.activity.input).toBe(2);
    expect(first.factors.adjustments.input).toBe(0);
    expect(first.factors.age).toMatchObject({ input: 45, neverAudited: false, contribution: 15 });

    const second = await breakdownOf('A-01-02');
    expect(second.factors.activity.input).toBe(2);
    expect(second.factors.adjustments.input).toBe(1);
    expect(second.factors.age).toMatchObject({ neverAudited: true, contribution: 30 });
    // 30 + 25 × 2/40 + 20 × 1/5 + 0 (never counted) = 35.25 → 35
    expect(second).toMatchObject({ total: 35.25, score: 35 });
  });

  // A count stored directly, with its own DONE task: these tests are about
  // how recompute reads results, not about the count flow.
  const storeCount = async (code: string, result: 'PASS' | 'FAIL', countedAt: Date) => {
    const bin = await prisma.bin.findUniqueOrThrow({ where: { code } });
    const plan = await prisma.auditPlan.create({ data: { requestedCount: 1, excludedPending: 0, excludedUnscored: 0 } });
    const task = await prisma.auditTask.create({
      data: {
        planId: plan.id,
        binId: bin.id,
        rank: 1,
        status: 'DONE',
        completedAt: countedAt,
        score: 0,
        priority: 'low',
        formulaVersion: 2,
        scoreReferenceAt: R,
        scoreComputedAt: R,
        breakdown: {},
      },
    });
    await prisma.count.create({ data: { taskId: task.id, binId: bin.id, result, inventoryVersion: bin.inventoryVersion, countedAt } });
  };

  it('the last result: unknown without counts, FAIL adds 25, a later PASS removes it', async () => {
    await recomputeScores(prisma, R);
    expect((await breakdownOf('A-01-01')).factors.lastResult).toEqual({ weight: 25, result: null, countedAt: null, factor: 0, contribution: 0 });
    const unknownScore = (await breakdownOf('A-01-01')).score;

    await storeCount('A-01-01', 'FAIL', at(-5 * DAY));
    await recomputeScores(prisma, R);
    expect((await breakdownOf('A-01-01')).factors.lastResult).toEqual({
      weight: 25,
      result: 'FAIL',
      countedAt: at(-5 * DAY).toISOString(),
      factor: 1,
      contribution: 25,
    });
    expect((await breakdownOf('A-01-01')).score).toBe(unknownScore + 25);

    await storeCount('A-01-01', 'PASS', at(-2 * DAY));
    await recomputeScores(prisma, R);
    expect((await breakdownOf('A-01-01')).factors.lastResult).toMatchObject({ result: 'PASS', countedAt: at(-2 * DAY).toISOString(), contribution: 0 });

    // PASS then FAIL: the FAIL is the latest, so the factor is active again.
    await storeCount('A-01-01', 'FAIL', at(-DAY));
    await recomputeScores(prisma, R);
    expect((await breakdownOf('A-01-01')).factors.lastResult).toMatchObject({ result: 'FAIL', contribution: 25 });
  });

  it('ignores counts after the reference and matches formula v2 computed in SQL', async () => {
    await storeCount('A-01-01', 'PASS', at(-3 * DAY));
    await storeCount('A-01-01', 'FAIL', at(1));
    await storeCount('A-01-02', 'FAIL', R);
    await recomputeScores(prisma, R);
    expect((await breakdownOf('A-01-01')).factors.lastResult).toMatchObject({ result: 'PASS', contribution: 0 });
    expect((await breakdownOf('A-01-02')).factors.lastResult).toMatchObject({ result: 'FAIL', contribution: 25 });
    const stored = await prisma.binScore.findMany({ include: { bin: true }, orderBy: { bin: { code: 'asc' } } });
    expect(stored.map((s) => ({ code: s.bin.code, score: s.score }))).toEqual(await scoresInSql(prisma, R));
  });

  it('replaces every score with one reference and keeps one score per bin', async () => {
    await recomputeScores(prisma, R);
    const later = at(DAY);
    await recomputeScores(prisma, later);
    const scores = await prisma.binScore.findMany();
    expect(scores).toHaveLength(2);
    expect(scores.every((s) => s.referenceAt.getTime() === later.getTime())).toBe(true);
    // One day later, A-01-01 is 46 days old.
    expect((await breakdownOf('A-01-01')).factors.age.input).toBe(46);
  });

  it('saves all scores or none: a failure while saving keeps the previous scores', async () => {
    await recomputeScores(prisma, R);
    const before = await businessSnapshot(prisma);
    // Make PostgreSQL reject the score row of the second bin.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_score_insert() RETURNS trigger AS $$
      BEGIN
        IF NEW.bin_id = (SELECT id FROM bins WHERE code = 'A-01-02') THEN
          RAISE EXCEPTION 'simulated failure while saving scores';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER fail_score_insert BEFORE INSERT ON bin_scores FOR EACH ROW EXECUTE FUNCTION fail_score_insert()',
    );
    try {
      await expect(recomputeScores(prisma, at(DAY))).rejects.toThrow(/simulated failure while saving scores/);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER fail_score_insert ON bin_scores');
      await prisma.$executeRawUnsafe('DROP FUNCTION fail_score_insert()');
    }
    expect(await businessSnapshot(prisma)).toEqual(before);
  });
});

import { generateDemoData } from '../src/demo-data/generate.js';
import { resetDemoData } from '../src/demo-data/reset.js';
import { PLAN_LOCK_KEY, createPlan } from '../src/planning/create-plan.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { computeScore } from '../src/scoring/formula.js';
import { recomputeScores } from '../src/scoring/recompute.js';
import { FIXED_REFERENCE, businessSnapshot, clearInventory } from './support.js';

// Top N plans against the real PostgreSQL test database (D-011, D-002).
describe('Audit plans (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const DAY = 86_400_000;
  const R = FIXED_REFERENCE;

  // Bins with stored scores written directly, so ties and ages are controlled.
  // `breakdownAudit` is what the stored breakdown says; `binAudit` is the
  // bin's current column, deliberately different where it matters.
  async function binsWithScores(
    rows: { code: string; score: number | null; breakdownAudit?: number | null; binAudit?: number | null }[],
  ) {
    await clearInventory(prisma);
    for (const [i, row] of rows.entries()) {
      const aisle = row.code[0];
      const daysAgo = (days: number | null | undefined) => (days === null || days === undefined ? null : new Date(R.getTime() - days * DAY));
      const bin = await prisma.bin.create({
        data: {
          code: row.code,
          aisle,
          rack: Number(row.code.slice(2, 4)),
          position: Number(row.code.slice(5, 7)),
          lastAuditedAt: daysAgo(row.binAudit),
        },
      });
      if (row.score !== null) {
        const breakdown = { ...computeScore({ lastAuditedAt: daysAgo(row.breakdownAudit), activity: 0, adjustments: 0, lastCount: null }, R), score: row.score };
        await prisma.binScore.create({
          data: { binId: bin.id, score: row.score, formulaVersion: breakdown.formulaVersion, referenceAt: R, computedAt: new Date(R.getTime() + i), breakdown },
        });
      }
    }
  }
  const planCodes = async (planId: number) =>
    (await prisma.auditTask.findMany({ where: { planId }, orderBy: { rank: 'asc' }, include: { bin: true } })).map((t) => t.bin.code);

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_task_insert ON audit_tasks');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_task_insert()');
    await prisma.$disconnect();
  });

  it('creates PENDING tasks in priority order with a full copy of the stored score', async () => {
    await binsWithScores([
      { code: 'A-01-01', score: 30, breakdownAudit: 5 },
      { code: 'A-01-02', score: 80, breakdownAudit: 5 },
      { code: 'A-01-03', score: 55, breakdownAudit: 5 },
    ]);
    const created = await createPlan(prisma, 2);
    expect(created.plan).toMatchObject({ requestedCount: 2, createdCount: 2, excluded: { pendingTask: 0, noScore: 0 } });
    expect(created.tasks.map((t) => [t.rank, t.binCode, t.score.value, t.score.priority])).toEqual([
      [1, 'A-01-02', 80, 'high'],
      [2, 'A-01-03', 55, 'medium'],
    ]);

    const tasks = await prisma.auditTask.findMany({ orderBy: { rank: 'asc' }, include: { bin: { include: { score: true } } } });
    for (const task of tasks) {
      const stored = task.bin.score!;
      expect(task).toMatchObject({
        status: 'PENDING',
        completedAt: null,
        score: stored.score,
        formulaVersion: stored.formulaVersion,
        scoreReferenceAt: stored.referenceAt,
        scoreComputedAt: stored.computedAt,
        breakdown: stored.breakdown,
      });
    }
  });

  it('breaks ties from the stored breakdown, also at the N boundary, ignoring the bin\'s current audit date', async () => {
    await binsWithScores([
      { code: 'A-01-01', score: 77, breakdownAudit: 10, binAudit: null },
      { code: 'A-01-02', score: 77, breakdownAudit: 80, binAudit: 0 },
      { code: 'A-01-03', score: 77, breakdownAudit: null, binAudit: 1 },
      { code: 'A-01-04', score: 77, breakdownAudit: null, binAudit: 1 },
      { code: 'A-01-05', score: 90, breakdownAudit: 1, binAudit: 1 },
    ]);
    // Using the bins' current column, A-01-01 (null) would come right after A-01-05.
    const top3 = await createPlan(prisma, 3);
    expect(await planCodes(top3.plan.id)).toEqual(['A-01-05', 'A-01-03', 'A-01-04']);
    const rest = await createPlan(prisma, 5);
    expect(await planCodes(rest.plan.id)).toEqual(['A-01-02', 'A-01-01']);
  });

  it('keeps a score of 0, excludes bins without a score and creates a partial plan', async () => {
    await binsWithScores([
      { code: 'A-01-01', score: 0, breakdownAudit: 1 },
      { code: 'A-01-02', score: null },
      { code: 'A-01-03', score: 45, breakdownAudit: 1 },
      { code: 'A-01-04', score: null },
    ]);
    const created = await createPlan(prisma, 5);
    expect(created.plan).toMatchObject({ requestedCount: 5, createdCount: 2, excluded: { pendingTask: 0, noScore: 2 } });
    expect(await planCodes(created.plan.id)).toEqual(['A-01-03', 'A-01-01']);
    expect(await prisma.auditPlan.findUniqueOrThrow({ where: { id: created.plan.id } })).toMatchObject({
      requestedCount: 5,
      excludedPending: 0,
      excludedUnscored: 2,
    });
  });

  it('excludes bins with a pending task, and creates no plan when none is left', async () => {
    await binsWithScores([
      { code: 'A-01-01', score: 60, breakdownAudit: 1 },
      { code: 'A-01-02', score: 50, breakdownAudit: 1 },
      { code: 'A-01-03', score: null },
    ]);
    await createPlan(prisma, 1);
    const second = await createPlan(prisma, 5);
    expect(second.plan).toMatchObject({ createdCount: 1, excluded: { pendingTask: 1, noScore: 1 } });
    expect(second.tasks.map((t) => t.binCode)).toEqual(['A-01-02']);

    await expect(createPlan(prisma, 5)).rejects.toMatchObject({ code: 'NO_AVAILABLE_BINS' });
    expect(await prisma.auditPlan.count()).toBe(2);
  });

  it('answers "recompute first" and creates nothing when no bin has a score', async () => {
    await binsWithScores([{ code: 'A-01-01', score: null }, { code: 'A-01-02', score: null }]);
    await expect(createPlan(prisma, 5)).rejects.toMatchObject({ code: 'NO_SCORES', message: expect.stringMatching(/recompute/) });
    expect(await prisma.auditPlan.count()).toBe(0);
  });

  it('rejects an invalid N before touching the database', async () => {
    await binsWithScores([{ code: 'A-01-01', score: 10, breakdownAudit: 1 }]);
    for (const n of [0, 31, 2.5, '5', null]) {
      await expect(createPlan(prisma, n)).rejects.toMatchObject({ code: 'INVALID_N' });
    }
    expect(await prisma.auditPlan.count()).toBe(0);
  });

  it('keeps the copied explanation when scores are recomputed later', async () => {
    await resetDemoData(prisma, generateDemoData({ reference: R }), { confirmReset: true });
    const created = await createPlan(prisma, 5);
    const before = await prisma.auditTask.findMany({ where: { planId: created.plan.id }, orderBy: { rank: 'asc' } });

    await recomputeScores(prisma, new Date(R.getTime() + 20 * DAY));
    const after = await prisma.auditTask.findMany({ where: { planId: created.plan.id }, orderBy: { rank: 'asc' } });
    expect(after).toEqual(before);
    // The live scores did change.
    const live = await prisma.binScore.findFirstOrThrow({ where: { binId: before[0].binId } });
    expect(live.referenceAt.getTime()).not.toBe(before[0].scoreReferenceAt.getTime());
  });

  it('creates the plan and its tasks atomically: a failure leaves neither', async () => {
    await binsWithScores([
      { code: 'A-01-01', score: 60, breakdownAudit: 1 },
      { code: 'A-01-02', score: 50, breakdownAudit: 1 },
    ]);
    const before = await businessSnapshot(prisma);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_task_insert() RETURNS trigger AS $$
      BEGIN
        IF NEW.bin_id = (SELECT id FROM bins WHERE code = 'A-01-02') THEN
          RAISE EXCEPTION 'simulated failure while saving tasks';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER fail_task_insert BEFORE INSERT ON audit_tasks FOR EACH ROW EXECUTE FUNCTION fail_task_insert()',
    );
    try {
      await expect(createPlan(prisma, 2)).rejects.toThrow(/simulated failure while saving tasks/);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER fail_task_insert ON audit_tasks');
      await prisma.$executeRawUnsafe('DROP FUNCTION fail_task_insert()');
    }
    expect(await businessSnapshot(prisma)).toEqual(before);
    expect(await prisma.auditPlan.count()).toBe(0);
  });

  it('PostgreSQL allows one PENDING task per bin and checks plan and task values', async () => {
    await binsWithScores([{ code: 'A-01-01', score: 60, breakdownAudit: 1 }]);
    const created = await createPlan(prisma, 1);
    const sql = (statement: string) => prisma.$executeRawUnsafe(statement);
    await sql(`INSERT INTO audit_plans (requested_count, excluded_pending, excluded_unscored) VALUES (1, 0, 0)`);
    const otherPlan = (await prisma.auditPlan.findFirstOrThrow({ where: { id: { not: created.plan.id } } })).id;
    const copy = `score, priority, formula_version, score_reference_at, score_computed_at, breakdown`;
    await expect(
      sql(`INSERT INTO audit_tasks (plan_id, bin_id, rank, ${copy}) SELECT ${otherPlan}, bin_id, 1, ${copy} FROM audit_tasks`),
    ).rejects.toThrow(/audit_tasks_one_pending_per_bin|Unique constraint/);
    await expect(sql(`INSERT INTO audit_plans (requested_count, excluded_pending, excluded_unscored) VALUES (31, 0, 0)`)).rejects.toThrow(
      /audit_plans_requested_count_check/,
    );
    await expect(sql(`UPDATE audit_tasks SET completed_at = now()`)).rejects.toThrow(/audit_tasks_completed_check/);
    await expect(sql(`UPDATE audit_tasks SET priority = 'urgent'`)).rejects.toThrow(/audit_tasks_priority_check/);
  });

  it('serves simultaneous requests in turn, each selecting again from what is left', async () => {
    await binsWithScores(
      ['A-01-01', 'A-01-02', 'A-01-03', 'A-01-04', 'A-01-05', 'A-02-01', 'A-02-02', 'A-02-03'].map((code, i) => ({
        code,
        score: 90 - i,
        breakdownAudit: 1,
      })),
    );
    const waiting = async () =>
      Number(
        (
          await prisma.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = ${PLAN_LOCK_KEY} AND NOT granted`
        )[0].n,
      );

    // Hold the plan lock so that both requests are queued at the same time.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const lockHeld = new Promise<void>((resolve) => (held = resolve));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PLAN_LOCK_KEY}::bigint)`;
        held();
        await gate;
      },
      { timeout: 20_000 },
    );
    await lockHeld;
    const first = createPlan(prisma, 5);
    const second = createPlan(prisma, 5);
    for (let i = 0; i < 100 && (await waiting()) < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await waiting()).toBe(2);
    release();
    await holder;

    const results = await Promise.allSettled([first, second]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const plans = results.map((r) => (r as PromiseFulfilledResult<Awaited<typeof first>>).value);
    expect(plans.map((p) => p.plan.createdCount).sort()).toEqual([3, 5]);
    const bins = plans.flatMap((p) => p.tasks.map((t) => t.binCode));
    expect(new Set(bins).size).toBe(8);
    // The request served second reports the five pending bins it skipped.
    expect(plans.find((p) => p.plan.createdCount === 3)!.plan.excluded).toEqual({ pendingTask: 5, noScore: 0 });

    await expect(createPlan(prisma, 5)).rejects.toMatchObject({ code: 'NO_AVAILABLE_BINS' });
    expect(await prisma.auditPlan.count()).toBe(2);
  });

  it('the demo reset deletes plans and tasks and reports how many', async () => {
    const data = generateDemoData({ reference: R });
    await resetDemoData(prisma, data, { confirmReset: true });
    await createPlan(prisma, 5);
    await createPlan(prisma, 3);
    const summary = await resetDemoData(prisma, data, { confirmReset: true });
    expect(summary.deleted).toEqual({ plans: 2, tasks: 8, counts: { total: 0, pass: 0, fail: 0, lines: 0, unexpectedPallets: 0 } });
    expect(await prisma.auditPlan.count()).toBe(0);
    expect(await prisma.auditTask.count()).toBe(0);
    expect(await prisma.binScore.count()).toBe(30);
  });

  // Independent of the selection code: the D-011 order written in SQL over the
  // stored breakdowns, with a fixed reference and controlled availability.
  it('matches the D-011 order computed in SQL on the demo data', async () => {
    await resetDemoData(prisma, generateDemoData({ reference: R }), { confirmReset: true });
    const expectedTop = (n: number) =>
      prisma.$queryRaw<{ code: string }[]>`
        SELECT b.code
        FROM bins b JOIN bin_scores s ON s.bin_id = b.id
        WHERE NOT EXISTS (SELECT 1 FROM audit_tasks t WHERE t.bin_id = b.id AND t.status = 'PENDING')
        ORDER BY s.score DESC,
                 (s.breakdown -> 'factors' -> 'age' ->> 'neverAudited')::boolean DESC,
                 (s.breakdown -> 'factors' -> 'age' ->> 'lastAuditedAt')::timestamptz ASC NULLS FIRST,
                 b.code COLLATE "C" ASC
        LIMIT ${n}`;

    // A tie at 77 falls on the boundary of N = 3: B-01-05 (never audited) wins.
    const firstExpected = (await expectedTop(3)).map((r) => r.code);
    const first = await createPlan(prisma, 3);
    expect(first.tasks.map((t) => t.binCode)).toEqual(firstExpected);
    expect(firstExpected).toEqual(['B-02-03', 'C-01-01', 'B-01-05']);

    // With those three pending, the next plan starts at A-02-01.
    const secondExpected = (await expectedTop(4)).map((r) => r.code);
    const second = await createPlan(prisma, 4);
    expect(second.tasks.map((t) => t.binCode)).toEqual(secondExpected);
    expect(secondExpected).toEqual(['A-02-01', 'A-01-05', 'C-01-03', 'B-01-04']);
  });
});

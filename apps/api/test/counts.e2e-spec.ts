import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { openCountSheet } from '../src/counting/sheet.js';
import { submitCount } from '../src/counting/submit.js';
import { generateDemoData } from '../src/demo-data/generate.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { resetDemoData } from '../src/demo-data/reset.js';
import { applyMovement, applyMovementInTransaction } from '../src/inventory/movements.js';
import { createPlan } from '../src/planning/create-plan.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { ScoreBreakdown } from '../src/scoring/formula.js';
import { SCORES_LOCK_KEY } from '../src/scoring/lock.js';
import { recomputeScores } from '../src/scoring/recompute.js';
import { businessSnapshot, clearInventory, scoresInSql } from './support.js';

// The count flow (D-001, D-003, D-004, D-012) on the real Nest application
// and PostgreSQL test database.
describe('Count flow (PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const DAY = 86_400_000;
  const R = new Date('2026-10-18T12:00:00Z');
  const day = (n: number) => new Date(R.getTime() + n * DAY);

  const sheet = (code: string) => request(app.getHttpServer()).get(`/bins/${encodeURIComponent(code)}/count-sheet`);
  const submit = (taskId: number, body: unknown) => request(app.getHttpServer()).post(`/audit-tasks/${taskId}/count`).send(body as object);
  const taskOf = async (code: string) => (await prisma.auditTask.findFirstOrThrow({ where: { bin: { code }, status: 'PENDING' } })).id;
  const versionOf = async (code: string) => (await prisma.bin.findUniqueOrThrow({ where: { code } })).inventoryVersion;
  const breakdownOf = async (code: string) =>
    (await prisma.binScore.findFirstOrThrow({ where: { bin: { code } } })).breakdown as unknown as ScoreBreakdown;
  const scoresTable = () =>
    prisma.binScore.findMany({ orderBy: { binId: 'asc' }, select: { binId: true, score: true, referenceAt: true, computedAt: true, breakdown: true } });

  // A-01-01: P-1 (10 cases) and P-2 (5 bags), version 2; A-01-02: P-3
  // (7 cases), version 1; A-01-03: empty. One plan with a task for each.
  // A-01-04 is created afterwards and has no task.
  beforeEach(async () => {
    await clearInventory(prisma);
    await prisma.product.createMany({
      data: [
        { sku: 'SKU-A', name: 'Bottled water', unit: 'case' },
        { sku: 'SKU-B', name: 'Rice', unit: 'bag' },
      ],
    });
    await prisma.bin.createMany({
      data: [1, 2, 3].map((position) => ({ code: `A-01-0${position}`, aisle: 'A', rack: 1, position })),
    });
    await applyMovement(prisma, { type: 'PUTAWAY', palletCode: 'P-1', productSku: 'SKU-A', binCode: 'A-01-01', quantity: 10, occurredAt: day(-10) });
    await applyMovement(prisma, { type: 'PUTAWAY', palletCode: 'P-2', productSku: 'SKU-B', binCode: 'A-01-01', quantity: 5, occurredAt: day(-9) });
    await applyMovement(prisma, { type: 'PUTAWAY', palletCode: 'P-3', productSku: 'SKU-A', binCode: 'A-01-02', quantity: 7, occurredAt: day(-8) });
    await recomputeScores(prisma, R);
    await createPlan(prisma, 30);
    await prisma.bin.create({ data: { code: 'A-01-04', aisle: 'A', rack: 1, position: 4 } });
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_score_insert ON bin_scores');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_score_insert()');
    await app?.close();
  });

  const exact = { inventoryVersion: 2, lines: [{ palletCode: 'P-1', countedQuantity: 10 }, { palletCode: 'P-2', countedQuantity: 5 }] };

  it('opens a count with the expected pallets, their version and the catalog; 404 and 409 otherwise', async () => {
    const { body } = await sheet(' a-01-01 ').expect(200);
    expect(body).toMatchObject({
      bin: { code: 'A-01-01' },
      task: { id: await taskOf('A-01-01'), rank: expect.any(Number) },
      inventoryVersion: 2,
      lines: [
        { palletCode: 'P-1', product: { sku: 'SKU-A', name: 'Bottled water', unit: 'case' }, expectedQuantity: 10 },
        { palletCode: 'P-2', product: { sku: 'SKU-B', name: 'Rice', unit: 'bag' }, expectedQuantity: 5 },
      ],
      products: [
        { sku: 'SKU-A', unit: 'case' },
        { sku: 'SKU-B', unit: 'bag' },
      ],
    });
    expect((await sheet('Z-09-09').expect(404)).body).toMatchObject({ code: 'BIN_NOT_FOUND' });
    expect((await sheet('A-01-04').expect(409)).body).toMatchObject({ code: 'NO_PENDING_TASK', message: expect.stringContaining('no pending audit task') });
  });

  it('PASS: stores the count, closes the task, sets the audit date and rescores every bin at the count time; inventory unchanged', async () => {
    const taskId = await taskOf('A-01-01');
    const before = await businessSnapshot(prisma);
    const { body } = await submit(taskId, exact).expect(201);

    expect(body).toMatchObject({
      recovered: false,
      count: {
        taskId,
        bin: { code: 'A-01-01' },
        result: 'PASS',
        inventoryVersion: 2,
        lines: [
          { palletCode: 'P-1', expectedQuantity: 10, countedQuantity: 10, variance: 0 },
          { palletCode: 'P-2', expectedQuantity: 5, countedQuantity: 5, variance: 0 },
        ],
        unexpected: [],
      },
    });
    const countedAt = new Date(body.count.countedAt);
    const task = await prisma.auditTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task).toMatchObject({ status: 'DONE', completedAt: countedAt });
    expect((await prisma.bin.findUniqueOrThrow({ where: { code: 'A-01-01' } })).lastAuditedAt).toEqual(countedAt);

    // Every bin, including A-01-04 (unscored before), at one reference.
    const scores = await scoresTable();
    expect(scores).toHaveLength(4);
    expect(scores.every((s) => s.referenceAt.getTime() === countedAt.getTime())).toBe(true);
    expect((await breakdownOf('A-01-01')).factors.lastResult).toMatchObject({ result: 'PASS', countedAt: countedAt.toISOString(), contribution: 0 });
    expect((await breakdownOf('A-01-01')).factors.age.contribution).toBe(0);
    expect(body.score).toMatchObject({ value: scores.find((s) => s.binId === task.binId)!.score });
    const listed = (await request(app.getHttpServer()).get('/audit-tasks').expect(200)).body.find((t: { id: number }) => t.id === taskId);
    expect(listed).toMatchObject({ status: 'DONE', count: { result: 'PASS', countedAt: body.count.countedAt } });

    // D-004: no inventory change; D-002: the task copies are kept.
    const after = await businessSnapshot(prisma);
    expect(after.pallets).toEqual(before.pallets);
    expect(after.movements).toEqual(before.movements);
    expect(after.bins.map((b) => [b.code, b.inventoryVersion])).toEqual(before.bins.map((b) => [b.code, b.inventoryVersion]));
    expect(after.plans.map((p) => p.tasks.map(({ status: _status, ...copy }) => copy))).toEqual(
      before.plans.map((p) => p.tasks.map(({ status: _status, ...copy }) => copy)),
    );
  });

  it('an empty bin with nothing found is a PASS', async () => {
    const { body } = await submit(await taskOf('A-01-03'), { inventoryVersion: 0, lines: [], unexpected: [] }).expect(201);
    expect(body.count).toMatchObject({ result: 'PASS', lines: [], unexpected: [] });
  });

  it('FAIL: by a quantity, by a pallet not found (0) and by an unexpected pallet; the score follows formula v2', async () => {
    const short = await submit(await taskOf('A-01-01'), {
      inventoryVersion: 2,
      lines: [{ palletCode: 'P-1', countedQuantity: 9 }, { palletCode: 'P-2', countedQuantity: 5 }],
    }).expect(201);
    expect(short.body.count).toMatchObject({ result: 'FAIL', lines: [{ palletCode: 'P-1', variance: -1 }, { palletCode: 'P-2', variance: 0 }] });

    const missing = await submit(await taskOf('A-01-02'), { inventoryVersion: 1, lines: [{ palletCode: 'P-3', countedQuantity: 0 }] }).expect(201);
    expect(missing.body.count).toMatchObject({ result: 'FAIL', lines: [{ palletCode: 'P-3', expectedQuantity: 7, countedQuantity: 0, variance: -7 }] });

    const extra = await submit(await taskOf('A-01-03'), {
      inventoryVersion: 0,
      lines: [],
      unexpected: [{ code: 'P-50', quantity: 4, productSku: 'SKU-A' }],
    }).expect(201);
    expect(extra.body.count).toMatchObject({ result: 'FAIL', unexpected: [{ code: 'P-50', quantity: 4, product: { sku: 'SKU-A', unit: 'case' } }] });

    const breakdown = await breakdownOf('A-01-03');
    expect(breakdown.factors.lastResult).toMatchObject({ result: 'FAIL', factor: 1, contribution: 25 });
    // Independent check: every stored score equals formula v2 in SQL.
    const reference = new Date(extra.body.count.countedAt);
    const stored = await prisma.binScore.findMany({ include: { bin: true }, orderBy: { bin: { code: 'asc' } } });
    expect(stored.map((s) => ({ code: s.bin.code, score: s.score }))).toEqual(await scoresInSql(prisma, reference));
  });

  it('an unexpected pallet of unknown product keeps its declared quantity, without inventing a SKU or unit; never creates inventory', async () => {
    const before = await businessSnapshot(prisma);
    const { body } = await submit(await taskOf('A-01-02'), {
      inventoryVersion: 1,
      lines: [{ palletCode: 'P-3', countedQuantity: 7 }],
      unexpected: [
        { code: ' x-9 ', quantity: 12, productSku: null },
        { code: 'p-77', quantity: 3, productSku: 'SKU-B' },
      ],
    }).expect(201);
    expect(body.count.result).toBe('FAIL');
    expect(body.count.unexpected).toEqual([
      { code: 'P-77', quantity: 3, product: { sku: 'SKU-B', name: 'Rice', unit: 'bag' } },
      { code: 'X-9', quantity: 12, product: null },
    ]);
    const stored = await prisma.unexpectedPallet.findMany({ orderBy: { code: 'asc' } });
    expect(stored.map((u) => [u.code, u.quantity, u.productId === null])).toEqual([
      ['P-77', 3, false],
      ['X-9', 12, true],
    ]);
    const after = await businessSnapshot(prisma);
    expect(after.pallets).toEqual(before.pallets);
    expect(after.products).toEqual(before.products);
  });

  it('rejects an invalid count with 400 and stores nothing', async () => {
    const taskId = await taskOf('A-01-01');
    const lines = exact.lines;
    const cases: [unknown, string][] = [
      [{ lines }, 'INVALID_COUNT'],
      [{ ...exact, lines: [{ palletCode: 'P-1', countedQuantity: -1 }, lines[1]] }, 'INVALID_COUNT'],
      [{ ...exact, lines: [{ palletCode: 'P-1', countedQuantity: 2.5 }, lines[1]] }, 'INVALID_COUNT'],
      [{ ...exact, lines: [{ palletCode: 'P-1', countedQuantity: '10' }, lines[1]] }, 'INVALID_COUNT'],
      [{ ...exact, lines: [lines[0], { palletCode: ' p-1', countedQuantity: 3 }] }, 'INVALID_COUNT'],
      [{ ...exact, lines: [lines[0]] }, 'LINES_MISMATCH'],
      [{ ...exact, lines: [...lines, { palletCode: 'P-3', countedQuantity: 7 }] }, 'LINES_MISMATCH'],
      [{ ...exact, unexpected: [{ code: 'x-1', quantity: 1 }, { code: 'X-1', quantity: 2 }] }, 'INVALID_COUNT'],
      [{ ...exact, unexpected: [{ code: 'X-1', quantity: 0 }] }, 'INVALID_COUNT'],
      [{ ...exact, unexpected: [{ code: '   ', quantity: 1 }] }, 'INVALID_COUNT'],
      [{ ...exact, unexpected: Array.from({ length: 11 }, (_, i) => ({ code: `X-${i}`, quantity: 1 })) }, 'INVALID_COUNT'],
      [{ ...exact, unexpected: [{ code: 'p-2', quantity: 1 }] }, 'UNEXPECTED_IS_EXPECTED'],
      [{ ...exact, unexpected: [{ code: 'X-1', quantity: 1, productSku: 'SKU-ZZ' }] }, 'UNKNOWN_PRODUCT'],
    ];
    for (const [body, code] of cases) {
      const response = await submit(taskId, body).expect(400);
      expect(response.body).toMatchObject({ statusCode: 400, code });
    }
    expect((await submit(999_999, exact).expect(404)).body).toMatchObject({ code: 'TASK_NOT_FOUND' });
    expect((await submit('abc' as unknown as number, exact).expect(404)).body).toMatchObject({ code: 'TASK_NOT_FOUND' });
    expect(await prisma.count.count()).toBe(0);
    expect((await prisma.auditTask.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('PENDING');
  });

  it('FAIL then PASS on the same bin: the last result decides the factor', async () => {
    await submit(await taskOf('A-01-02'), { inventoryVersion: 1, lines: [{ palletCode: 'P-3', countedQuantity: 6 }] }).expect(201);
    expect((await breakdownOf('A-01-02')).factors.lastResult).toMatchObject({ result: 'FAIL', contribution: 25 });

    // A later plan gives the bin a new task (the earlier one is DONE).
    await createPlan(prisma, 30);
    const { body } = await submit(await taskOf('A-01-02'), { inventoryVersion: 1, lines: [{ palletCode: 'P-3', countedQuantity: 7 }] }).expect(201);
    expect(body.count.result).toBe('PASS');
    const breakdown = await breakdownOf('A-01-02');
    expect(breakdown.factors.lastResult).toMatchObject({ result: 'PASS', countedAt: body.count.countedAt, contribution: 0 });
    const stored = await prisma.binScore.findMany({ include: { bin: true }, orderBy: { bin: { code: 'asc' } } });
    expect(stored.map((s) => ({ code: s.bin.code, score: s.score }))).toEqual(await scoresInSql(prisma, new Date(body.count.countedAt)));
  });

  it('an identical retry returns the stored count as recovered, without repeating effects, even after the inventory changed', async () => {
    const taskId = await taskOf('A-01-01');
    const first = await submit(taskId, { ...exact, unexpected: [{ code: 'X-1', quantity: 2 }] }).expect(201);
    const scoresAfterFirst = await scoresTable();
    const countsAfterFirst = await businessSnapshot(prisma);

    // Same normalised content: codes in other case and spacing, other order.
    const retry = {
      inventoryVersion: 2,
      lines: [{ palletCode: ' p-2', countedQuantity: 5 }, { palletCode: 'p-1 ', countedQuantity: 10 }],
      unexpected: [{ code: 'x-1', quantity: 2, productSku: null }],
    };
    const again = await submit(taskId, retry).expect(200);
    expect(again.body).toMatchObject({ recovered: true, count: { id: first.body.count.id, result: 'FAIL' } });
    expect(await scoresTable()).toEqual(scoresAfterFirst);
    expect(await businessSnapshot(prisma)).toEqual(countsAfterFirst);

    await applyMovement(prisma, { type: 'PICK', palletCode: 'P-1', quantity: 1, occurredAt: R });
    const afterMovement = await submit(taskId, retry).expect(200);
    expect(afterMovement.body).toMatchObject({ recovered: true, count: { id: first.body.count.id } });
    expect(await prisma.count.count()).toBe(1);
  });

  it('other content for a counted task is rejected with the stored result; an old form never completes a later task of the bin', async () => {
    const firstTask = await taskOf('A-01-02');
    await submit(firstTask, { inventoryVersion: 1, lines: [{ palletCode: 'P-3', countedQuantity: 7 }] }).expect(201);
    await createPlan(prisma, 30);
    const laterTask = await taskOf('A-01-02');
    expect(laterTask).not.toBe(firstTask);

    const { body } = await submit(firstTask, { inventoryVersion: 1, lines: [{ palletCode: 'P-3', countedQuantity: 6 }] }).expect(409);
    expect(body).toMatchObject({
      code: 'TASK_ALREADY_COUNTED',
      message: expect.stringContaining('The new quantities were not saved'),
      count: { taskId: firstTask, result: 'PASS', lines: [{ palletCode: 'P-3', countedQuantity: 7 }] },
    });
    expect(await prisma.count.count()).toBe(1);
    expect((await prisma.auditTask.findUniqueOrThrow({ where: { id: laterTask } })).status).toBe('PENDING');
  });

  // Waits until `n` sessions are blocked on the given kind of lock.
  const waitForWaiters = async (n: number, kind: 'scores' | 'row') => {
    const waiting = async () =>
      Number(
        (
          kind === 'scores'
            ? await prisma.$queryRaw<{ n: bigint }[]>`
                SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = ${SCORES_LOCK_KEY} AND NOT granted`
            : await prisma.$queryRaw<{ n: bigint }[]>`
                SELECT count(*) AS n FROM pg_locks WHERE locktype IN ('transactionid', 'tuple') AND NOT granted`
        )[0].n,
      );
    for (let i = 0; i < 200 && (await waiting()) < n; i++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(await waiting()).toBeGreaterThanOrEqual(n);
  };

  // A transaction that runs `hold` and keeps its locks until released.
  const holdLocks = async (hold: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    const done = prisma.$transaction(
      async (tx) => {
        await hold(tx);
        held();
        await gate;
      },
      { timeout: 30_000 },
    );
    await holding;
    return { release: async () => (release(), await done) };
  };

  it('simultaneous submissions of one task store one count: identical → recovered, different → rejected', async () => {
    const holder = await holdLocks((tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(${SCORES_LOCK_KEY}::bigint)`);
    const taskId = await taskOf('A-01-01');
    const both = [submitCount(prisma, taskId, exact), submitCount(prisma, taskId, exact)];
    await waitForWaiters(2, 'scores');
    await holder.release();
    const results = await Promise.all(both);
    expect(results.map((r) => r.recovered).sort()).toEqual([false, true]);
    expect(results[0].count.id).toBe(results[1].count.id);

    const holder2 = await holdLocks((tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(${SCORES_LOCK_KEY}::bigint)`);
    const other = await taskOf('A-01-02');
    const different = [
      submitCount(prisma, other, { inventoryVersion: 1, lines: [{ palletCode: 'P-3', countedQuantity: 7 }] }),
      submitCount(prisma, other, { inventoryVersion: 1, lines: [{ palletCode: 'P-3', countedQuantity: 5 }] }),
    ];
    await waitForWaiters(2, 'scores');
    await holder2.release();
    const settled = await Promise.allSettled(different);
    expect(settled.map((s) => s.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(settled.find((s) => s.status === 'rejected')).toMatchObject({ reason: { code: 'TASK_ALREADY_COUNTED' } });
    expect(await prisma.count.count()).toBe(2);
  });

  // D-001, verification 1.
  it('a movement between opening and submitting: 409 with the changes, nothing stored; a recount with the new version is saved', async () => {
    const opened = await openCountSheet(prisma, 'A-01-01');
    const scoresBefore = await scoresTable();
    await applyMovement(prisma, { type: 'PICK', palletCode: 'P-1', quantity: 2, occurredAt: R });
    await applyMovement(prisma, { type: 'PUTAWAY', palletCode: 'P-9', productSku: 'SKU-B', binCode: 'A-01-01', quantity: 3, occurredAt: R });

    const { body } = await submit(opened.task.id, { ...exact, unexpected: [{ code: 'P-9', quantity: 3 }] }).expect(409);
    expect(body).toMatchObject({
      code: 'INVENTORY_CHANGED',
      message: expect.stringContaining('Nothing was saved'),
      inventoryVersion: 4,
      lines: [
        { palletCode: 'P-1', expectedQuantity: 8 },
        { palletCode: 'P-2', expectedQuantity: 5 },
        { palletCode: 'P-9', expectedQuantity: 3 },
      ],
      changes: [
        { palletCode: 'P-1', change: 'changed' },
        { palletCode: 'P-9', change: 'added' },
      ],
      unexpectedNowExpected: ['P-9'],
    });
    expect(await prisma.count.count()).toBe(0);
    expect((await prisma.auditTask.findUniqueOrThrow({ where: { id: opened.task.id } })).status).toBe('PENDING');
    expect(await versionOf('A-01-01')).toBe(4);
    expect(await scoresTable()).toEqual(scoresBefore);

    // Only an explicit new submission with the new version is saved.
    const recount = await submit(opened.task.id, {
      inventoryVersion: 4,
      lines: [
        { palletCode: 'P-1', countedQuantity: 8 },
        { palletCode: 'P-2', countedQuantity: 5 },
        { palletCode: 'P-9', countedQuantity: 3 },
      ],
    }).expect(201);
    expect(recount.body.count).toMatchObject({ result: 'PASS', inventoryVersion: 4 });
  });

  // D-001, verification 2.
  it('a movement holding the bin lock first: the submission waits, then gets 409', async () => {
    const taskId = await taskOf('A-01-01');
    const movement = await holdLocks((tx) =>
      applyMovementInTransaction(tx, { type: 'PICK', palletCode: 'P-1', quantity: 1, occurredAt: R }),
    );
    const submission = submitCount(prisma, taskId, exact);
    await waitForWaiters(1, 'row');
    await movement.release();
    await expect(submission).rejects.toMatchObject({ code: 'INVENTORY_CHANGED', details: { inventoryVersion: 3 } });
    expect(await prisma.count.count()).toBe(0);
  });

  // D-001, verification 3.
  it('a submission holding the bin lock first: the movement waits; the count keeps the pre-movement values', async () => {
    const taskId = await taskOf('A-01-01');
    // Block the submission while it already holds the bin lock: the
    // recompute must rewrite this score row.
    const binId = (await prisma.bin.findUniqueOrThrow({ where: { code: 'A-01-01' } })).id;
    const scoreRow = await holdLocks((tx) => tx.$queryRaw`SELECT bin_id FROM bin_scores WHERE bin_id = ${binId} FOR UPDATE`);
    const submission = submitCount(prisma, taskId, exact);
    await waitForWaiters(1, 'row');
    const movement = applyMovement(prisma, { type: 'PICK', palletCode: 'P-1', quantity: 3, occurredAt: R });
    await waitForWaiters(2, 'row');
    await scoreRow.release();

    const saved = await submission;
    await movement;
    expect(saved.count).toMatchObject({ result: 'PASS', inventoryVersion: 2, lines: [{ palletCode: 'P-1', expectedQuantity: 10 }, { palletCode: 'P-2' }] });
    expect(await versionOf('A-01-01')).toBe(3);
    expect((await prisma.pallet.findUniqueOrThrow({ where: { code: 'P-1' } })).quantity).toBe(7);
    expect(await prisma.count.count()).toBe(1);
  });

  it('if the recompute fails, nothing of the count is kept', async () => {
    const taskId = await taskOf('A-01-01');
    const before = await businessSnapshot(prisma);
    const scoresBefore = await scoresTable();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_score_insert() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated failure while recomputing'; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER fail_score_insert BEFORE INSERT ON bin_scores FOR EACH ROW EXECUTE FUNCTION fail_score_insert()');
    try {
      await submit(taskId, exact).expect(500);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER fail_score_insert ON bin_scores');
      await prisma.$executeRawUnsafe('DROP FUNCTION fail_score_insert()');
    }
    expect(await businessSnapshot(prisma)).toEqual(before);
    expect(await scoresTable()).toEqual(scoresBefore);
    expect(await prisma.countLine.count()).toBe(0);
    expect((await prisma.auditTask.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('PENDING');
  });

  it('plan creation waits while a count holds the scores lock', async () => {
    const holder = await holdLocks((tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(${SCORES_LOCK_KEY}::bigint)`);
    const plan = createPlan(prisma, 1).catch((error: unknown) => error);
    await waitForWaiters(1, 'scores');
    await holder.release();
    await plan;
  });

  // A recompute asked for "now" while a count holds the scores lock: the
  // count saves a FAIL during the wait; the recompute that follows must score
  // with a time after it, keeping the FAIL (and the new audit date).
  it('a recompute asked while a count holds the turn scores after the count: its FAIL is kept', async () => {
    const holder = await holdLocks((tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(${SCORES_LOCK_KEY}::bigint)`);
    const taskId = await taskOf('A-01-01');
    const count = submit(taskId, { ...exact, lines: [{ palletCode: 'P-1', countedQuantity: 9 }, { palletCode: 'P-2', countedQuantity: 5 }] }).then((r) => r);
    await waitForWaiters(1, 'scores');
    const recompute = request(app.getHttpServer()).post('/scores/recompute').then((r) => r);
    await waitForWaiters(2, 'scores');
    await holder.release();
    const [saved, recomputed] = await Promise.all([count, recompute]);
    expect(saved.status).toBe(201);
    expect(saved.body.count.result).toBe('FAIL');
    expect(recomputed.status).toBe(200);

    const countedAt = new Date(saved.body.count.countedAt);
    const reference = new Date(recomputed.body.reference);
    expect(reference.getTime()).toBeGreaterThanOrEqual(countedAt.getTime());
    const after = await breakdownOf('A-01-01');
    expect(after.reference).toBe(reference.toISOString());
    expect(after.factors.lastResult).toMatchObject({ result: 'FAIL', contribution: 25 });
    expect(after.factors.age.input).toBeCloseTo((reference.getTime() - countedAt.getTime()) / DAY, 9);
    const stored = (await scoresTable()).map((s) => s.score);
    expect(stored).toEqual((await scoresInSql(prisma, reference)).map((s) => s.score));
  });

  it('PostgreSQL rejects a second count per task, a count for another bin and invalid rows', async () => {
    const taskId = await taskOf('A-01-02');
    await submit(taskId, { inventoryVersion: 1, lines: [{ palletCode: 'P-3', countedQuantity: 7 }] }).expect(201);
    const sql = (statement: string) => prisma.$executeRawUnsafe(statement);
    const count = await prisma.count.findFirstOrThrow();
    const otherBin = (await prisma.bin.findUniqueOrThrow({ where: { code: 'A-01-03' } })).id;
    const pallet = (await prisma.pallet.findUniqueOrThrow({ where: { code: 'P-3' } })).id;

    await expect(
      sql(`INSERT INTO counts (task_id, bin_id, result, inventory_version, counted_at) VALUES (${taskId}, ${count.binId}, 'PASS', 1, now())`),
    ).rejects.toThrow(/counts_task_id|Unique constraint/);
    const pending = await taskOf('A-01-01');
    await expect(
      sql(`INSERT INTO counts (task_id, bin_id, result, inventory_version, counted_at) VALUES (${pending}, ${otherBin}, 'PASS', 0, now())`),
    ).rejects.toThrow(/counts_task_id_bin_id_fkey|Foreign key/);
    await expect(
      sql(`INSERT INTO count_lines (count_id, pallet_id, expected_quantity, counted_quantity, variance) VALUES (${count.id}, ${pallet}, 7, 5, 0)`),
    ).rejects.toThrow(/count_lines_variance_check/);
    await expect(sql(`INSERT INTO count_unexpected_pallets (count_id, code, quantity) VALUES (${count.id}, 'x-1', 1)`)).rejects.toThrow(
      /count_unexpected_pallets_code_check/,
    );
    await expect(sql(`INSERT INTO count_unexpected_pallets (count_id, code, quantity) VALUES (${count.id}, 'X-1', 0)`)).rejects.toThrow(
      /count_unexpected_pallets_quantity_check/,
    );
  });

  it('the demo reset deletes counts, lines and unexpected pallets and reports them; a failed reset keeps them', async () => {
    await submit(await taskOf('A-01-01'), { ...exact, unexpected: [{ code: 'X-1', quantity: 1 }] }).expect(201);
    await submit(await taskOf('A-01-02'), { inventoryVersion: 1, lines: [{ palletCode: 'P-3', countedQuantity: 7 }] }).expect(201);
    const data = generateDemoData({ reference: R });

    const before = await businessSnapshot(prisma);
    const broken = { ...data, movements: [...data.movements, { type: 'PICK' as const, palletCode: 'P-0001', quantity: 100_000, occurredAt: day(-1) }] };
    await expect(resetDemoData(prisma, broken, { confirmReset: true })).rejects.toMatchObject({ name: 'MovementError' });
    expect(await businessSnapshot(prisma)).toEqual(before);

    const summary = await resetDemoData(prisma, data, { confirmReset: true });
    expect(summary.deleted).toEqual({ plans: 1, tasks: 3, counts: { total: 2, pass: 1, fail: 1, lines: 3, unexpectedPallets: 1 } });
    expect(await prisma.count.count()).toBe(0);
    expect(await prisma.countLine.count()).toBe(0);
    expect(await prisma.unexpectedPallet.count()).toBe(0);
  });
});

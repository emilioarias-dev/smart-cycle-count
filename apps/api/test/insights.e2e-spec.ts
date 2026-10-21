import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { generateDemoData } from '../src/demo-data/generate.js';
import { resetDemoData } from '../src/demo-data/reset.js';
import { InsightsService } from '../src/insights/insights.service.js';
import { createPlan } from '../src/planning/create-plan.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { recomputeScores } from '../src/scoring/recompute.js';
import { FIXED_REFERENCE, businessSnapshot, clearInventory } from './support.js';

// GET /insights/audits (D-019): coverage, counts and the observed FAIL
// proportion over the saved counts of the last 30 days, and each bin's latest
// result in that period.
describe('Audit insights API (PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const DAY = 86_400_000;
  const insights = async () => (await request(app.getHttpServer()).get('/insights/audits').expect(200)).body as any;
  const scope = (body: any, aisle: string | null) => body.scopes.find((s: any) => s.aisle === aisle);
  const latestOf = (body: any, code: string) => body.bins.find((b: any) => b.code === code);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  // 30 bins, 10 per aisle (A, B, C; racks 01–02, positions 01–05), no counts.
  async function thirtyBins(): Promise<void> {
    await clearInventory(prisma);
    await prisma.product.create({ data: { sku: 'SKU-A', name: 'Bottled water', unit: 'case' } });
    await prisma.bin.createMany({
      data: ['A', 'B', 'C'].flatMap((aisle) =>
        [1, 2].flatMap((rack) => [1, 2, 3, 4, 5].map((position) => ({ code: `${aisle}-0${rack}-0${position}`, aisle, rack, position }))),
      ),
    });
  }

  // A saved count as the count flow stores it: its own plan and DONE task,
  // with optional lines and unexpected pallets.
  async function addCount(code: string, result: 'PASS' | 'FAIL', countedAt: Date, extra: { lines?: number; unexpected?: number } = {}): Promise<number> {
    const bin = await prisma.bin.findUniqueOrThrow({ where: { code } });
    const product = await prisma.product.findFirstOrThrow();
    const plan = await prisma.auditPlan.create({ data: { requestedCount: 1, excludedPending: 0, excludedUnscored: 0, createdAt: countedAt } });
    const task = await prisma.auditTask.create({
      data: {
        planId: plan.id,
        binId: bin.id,
        rank: 1,
        status: 'DONE',
        completedAt: countedAt,
        score: 50,
        priority: 'medium',
        formulaVersion: 2,
        scoreReferenceAt: countedAt,
        scoreComputedAt: countedAt,
        breakdown: {},
      },
    });
    const count = await prisma.count.create({ data: { taskId: task.id, binId: bin.id, result, inventoryVersion: 0, countedAt } });
    for (let i = 1; i <= (extra.lines ?? 0); i += 1) {
      const pallet = await prisma.pallet.create({ data: { code: `P-${count.id}-${i}`, productId: product.id, binId: bin.id, quantity: 4 } });
      await prisma.countLine.create({ data: { countId: count.id, palletId: pallet.id, expectedQuantity: 4, countedQuantity: 3, variance: -1 } });
    }
    for (let i = 1; i <= (extra.unexpected ?? 0); i += 1) {
      await prisma.unexpectedPallet.create({ data: { countId: count.id, code: `X-${count.id}-${i}`, quantity: 2 } });
    }
    return count.id;
  }

  it('the worked example: whole warehouse, aisle A, latest results per aisle and the bins behind each part', async () => {
    await thirtyBins();
    const now = Date.now();
    const ago = (hours: number) => new Date(now - hours * 3_600_000);
    await addCount('A-01-01', 'FAIL', ago(48));
    await addCount('A-01-01', 'PASS', ago(24));
    await addCount('A-01-02', 'PASS', ago(30));
    await addCount('B-01-01', 'FAIL', ago(10));

    const body = await insights();
    expect(body.scopes.map((s: any) => s.aisle)).toEqual([null, 'A', 'B', 'C']);
    expect(scope(body, null)).toEqual({
      aisle: null,
      bins: 30,
      coverage: { numerator: 3, denominator: 30, percent: 10 },
      counts: { total: 4, pass: 2, fail: 2 },
      failProportion: { numerator: 2, denominator: 4, percent: 50 },
      latestResults: { pass: 2, fail: 1, none: 27 },
    });
    expect(scope(body, 'A')).toEqual({
      aisle: 'A',
      bins: 10,
      coverage: { numerator: 2, denominator: 10, percent: 20 },
      counts: { total: 3, pass: 2, fail: 1 },
      failProportion: { numerator: 1, denominator: 3, percent: 33.3 },
      latestResults: { pass: 2, fail: 0, none: 8 },
    });
    expect(scope(body, 'B').latestResults).toEqual({ pass: 0, fail: 1, none: 9 });
    expect(scope(body, 'C')).toMatchObject({ coverage: { numerator: 0, denominator: 10, percent: 0 }, failProportion: { numerator: 0, denominator: 0, percent: null } });
    // Every bin is in exactly one part of its aisle's bar.
    for (const s of body.scopes) {
      expect(s.latestResults.pass + s.latestResults.fail + s.latestResults.none).toBe(s.bins);
    }

    // The bins behind a part: FAIL of aisle B is B-01-01 only. A-01-01's
    // latest is the PASS after its FAIL, with its two counts.
    expect(body.bins).toHaveLength(30);
    expect(body.bins.filter((b: any) => b.aisle === 'B' && b.latest?.result === 'FAIL').map((b: any) => b.code)).toEqual(['B-01-01']);
    expect(latestOf(body, 'A-01-01')).toEqual({ code: 'A-01-01', aisle: 'A', counts: 2, latest: { result: 'PASS', countedAt: ago(24).toISOString() } });
    expect(latestOf(body, 'A-01-03')).toEqual({ code: 'A-01-03', aisle: 'A', counts: 0, latest: null });
    // Location order: A-01-01 … A-01-05, A-02-01 …
    expect(body.bins.slice(0, 6).map((b: any) => b.code)).toEqual(['A-01-01', 'A-01-02', 'A-01-03', 'A-01-04', 'A-01-05', 'A-02-01']);

    // One reference for the answer; the period is the 30 days before it, in UTC.
    expect(body.period).toEqual({ days: 30, start: new Date(Date.parse(body.reference) - 30 * DAY).toISOString(), end: body.reference });
    expect(Math.abs(Date.parse(body.reference) - Date.now())).toBeLessThan(10_000);
  });

  it('no counts: coverage 0 of the bins, FAIL proportion undefined (null), every bin without a count', async () => {
    await thirtyBins();
    const body = await insights();
    expect(scope(body, null)).toEqual({
      aisle: null,
      bins: 30,
      coverage: { numerator: 0, denominator: 30, percent: 0 },
      counts: { total: 0, pass: 0, fail: 0 },
      failProportion: { numerator: 0, denominator: 0, percent: null },
      latestResults: { pass: 0, fail: 0, none: 30 },
    });
  });

  it('no bins: one empty scope for the whole warehouse, no percentage for either ratio', async () => {
    await clearInventory(prisma);
    const body = await insights();
    expect(body.scopes).toEqual([
      {
        aisle: null,
        bins: 0,
        coverage: { numerator: 0, denominator: 0, percent: null },
        counts: { total: 0, pass: 0, fail: 0 },
        failProportion: { numerator: 0, denominator: 0, percent: null },
        latestResults: { pass: 0, fail: 0, none: 0 },
      },
    ]);
    expect(body.bins).toEqual([]);
  });

  it('simulated audit dates are not counts: the demo warehouse has no coverage and no results; reading changes nothing', async () => {
    await resetDemoData(prisma, generateDemoData({ reference: FIXED_REFERENCE }), { confirmReset: true });
    // Some bins have a recent simulated audit date, but no count behind it.
    expect(await prisma.bin.count({ where: { lastAuditedAt: { not: null } } })).toBeGreaterThan(0);
    const before = await businessSnapshot(prisma);
    const computed = await prisma.binScore.findMany({ orderBy: { binId: 'asc' }, select: { binId: true, computedAt: true } });

    const body = await insights();
    expect(scope(body, null)).toMatchObject({ bins: 30, coverage: { numerator: 0, percent: 0 }, counts: { total: 0 }, failProportion: { percent: null }, latestResults: { none: 30 } });
    // Not the reference of the scores or of the demo data.
    expect(body.reference).not.toBe(FIXED_REFERENCE.toISOString());

    expect(await businessSnapshot(prisma)).toEqual(before);
    expect(await prisma.binScore.findMany({ orderBy: { binId: 'asc' }, select: { binId: true, computedAt: true } })).toEqual(computed);
  });

  it('period (T − 30 days, T]: the start is excluded, T included, later counts excluded', async () => {
    await thirtyBins();
    const T = FIXED_REFERENCE;
    const start = new Date(T.getTime() - 30 * DAY);
    await addCount('A-01-01', 'FAIL', start);
    await addCount('A-01-02', 'PASS', new Date(start.getTime() + 1));
    await addCount('A-01-03', 'FAIL', T);
    await addCount('A-01-04', 'FAIL', new Date(T.getTime() + 1));

    const result = await app.get(InsightsService).audits(T);
    expect(result.period).toEqual({ days: 30, start, end: T });
    expect(result.scopes[0]).toMatchObject({ coverage: { numerator: 2, denominator: 30 }, counts: { total: 2, pass: 1, fail: 1 } });
    expect(result.bins.filter((b) => b.counts > 0).map((b) => [b.code, b.latest?.result])).toEqual([
      ['A-01-02', 'PASS'],
      ['A-01-03', 'FAIL'],
    ]);
  });

  it('a count dated after the request time is not shown by the API', async () => {
    await thirtyBins();
    await addCount('C-02-05', 'FAIL', new Date(Date.now() + DAY));
    const body = await insights();
    expect(scope(body, null)).toMatchObject({ coverage: { numerator: 0 }, counts: { total: 0 } });
    expect(latestOf(body, 'C-02-05').latest).toBeNull();
  });

  it('two counts of a bin at the same time: the latest is the one with the higher id', async () => {
    await thirtyBins();
    const at = new Date(Date.now() - DAY);
    await addCount('A-01-01', 'FAIL', at);
    await addCount('A-01-01', 'PASS', at);
    await addCount('B-01-01', 'PASS', at);
    await addCount('B-01-01', 'FAIL', at);
    const body = await insights();
    expect(latestOf(body, 'A-01-01')).toMatchObject({ counts: 2, latest: { result: 'PASS' } });
    expect(latestOf(body, 'B-01-01')).toMatchObject({ counts: 2, latest: { result: 'FAIL' } });
  });

  it('lines and unexpected pallets do not multiply counts; no quantity is summed', async () => {
    await thirtyBins();
    const at = new Date(Date.now() - DAY);
    await addCount('A-01-01', 'FAIL', at, { lines: 3, unexpected: 2 });
    await addCount('A-01-02', 'PASS', at, { lines: 2 });
    await addCount('B-01-01', 'FAIL', at, { unexpected: 3 });
    const body = await insights();
    expect(scope(body, null)).toMatchObject({
      coverage: { numerator: 3, denominator: 30 },
      counts: { total: 3, pass: 1, fail: 2 },
      failProportion: { numerator: 2, denominator: 3, percent: 66.7 },
    });
    expect(latestOf(body, 'A-01-01').counts).toBe(1);
  });

  it('an identical retry of a count is recovered: no extra count, the same coverage', async () => {
    await thirtyBins();
    await recomputeScores(prisma, new Date());
    await createPlan(prisma, 1);
    const task = await prisma.auditTask.findFirstOrThrow({ where: { status: 'PENDING' }, include: { bin: true } });
    const payload = { inventoryVersion: 0, lines: [], unexpected: [] };
    const submit = () => request(app.getHttpServer()).post(`/audit-tasks/${task.id}/count`).send(payload);

    expect((await submit().expect(201)).body.recovered).toBe(false);
    const first = await insights();
    expect((await submit().expect(200)).body.recovered).toBe(true);
    const second = await insights();

    expect(scope(first, null)).toMatchObject({ coverage: { numerator: 1, denominator: 30 }, counts: { total: 1, pass: 1, fail: 0 } });
    expect(second.scopes).toEqual(first.scopes);
    expect(latestOf(second, task.bin.code)).toMatchObject({ counts: 1, latest: { result: 'PASS' } });
  });
});

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { generateDemoData } from '../src/demo-data/generate.js';
import { resetDemoData } from '../src/demo-data/reset.js';
import { createPlan } from '../src/planning/create-plan.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { computeScore } from '../src/scoring/formula.js';
import { FIXED_REFERENCE, clearInventory } from './support.js';

// GET /scores/top: the dashboard's Top 5 of all bins, in the D-011 order.
describe('Top scores API (PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const R = FIXED_REFERENCE;
  const DAY = 86_400_000;
  const top = async () => (await request(app.getHttpServer()).get('/scores/top').expect(200)).body as any[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  // Independent of the selection code: the D-011 order in SQL over the stored
  // breakdowns of every scored bin, pending tasks included.
  it('returns the five highest stored scores of all bins, with their breakdown, in the D-011 order computed in SQL', async () => {
    await resetDemoData(prisma, generateDemoData({ reference: R }), { confirmReset: true });
    // Pending tasks do not remove a bin from the chart.
    await createPlan(prisma, 3);
    const expected = await prisma.$queryRaw<{ code: string; score: number }[]>`
      SELECT b.code, s.score
      FROM bins b JOIN bin_scores s ON s.bin_id = b.id
      ORDER BY s.score DESC,
               (s.breakdown -> 'factors' -> 'age' ->> 'neverAudited')::boolean DESC,
               (s.breakdown -> 'factors' -> 'age' ->> 'lastAuditedAt')::timestamptz ASC NULLS FIRST,
               b.code COLLATE "C" ASC
      LIMIT 5`;

    const body = await top();
    expect(body.map((t) => [t.rank, t.binCode, t.score.value])).toEqual(expected.map((e, i) => [i + 1, e.code, e.score]));
    // The 57 tie: B-01-05 (never audited) before A-02-01 (audited 83 days before).
    expect(body.map((t) => t.binCode)).toEqual(['B-02-03', 'C-01-01', 'B-01-05', 'A-02-01', 'A-01-05']);
    expect(body[2].score.breakdown.factors.age.neverAudited).toBe(true);
    expect(body[3].score.breakdown.factors.age.neverAudited).toBe(false);

    for (const entry of body) {
      const stored = await prisma.binScore.findFirstOrThrow({ where: { bin: { code: entry.binCode } } });
      expect(entry.score).toMatchObject({ value: stored.score, formulaVersion: stored.formulaVersion, reference: stored.referenceAt.toISOString() });
      expect(entry.score.breakdown).toEqual(stored.breakdown);
      expect(Object.keys(entry.score.breakdown.factors).sort()).toEqual(['activity', 'adjustments', 'age', 'lastResult']);
    }
  });

  it('breaks ties from the stored breakdown, not from the bin\'s current audit date, and skips unscored bins', async () => {
    await clearInventory(prisma);
    const rows: { code: string; score: number | null; breakdownAudit?: number | null; binAudit?: number | null }[] = [
      { code: 'A-01-01', score: 50, breakdownAudit: 10, binAudit: null },
      { code: 'A-01-02', score: 50, breakdownAudit: 80, binAudit: 0 },
      { code: 'A-01-03', score: 50, breakdownAudit: null, binAudit: 1 },
      { code: 'A-01-04', score: null },
      { code: 'A-01-05', score: 20, breakdownAudit: 1 },
      { code: 'A-02-01', score: 50, breakdownAudit: null, binAudit: 1 },
      { code: 'A-02-02', score: 10, breakdownAudit: 1 },
    ];
    const daysAgo = (days: number | null | undefined) => (days === null || days === undefined ? null : new Date(R.getTime() - days * DAY));
    for (const row of rows) {
      const bin = await prisma.bin.create({
        data: { code: row.code, aisle: 'A', rack: Number(row.code.slice(2, 4)), position: Number(row.code.slice(5, 7)), lastAuditedAt: daysAgo(row.binAudit) },
      });
      if (row.score !== null) {
        const breakdown = { ...computeScore({ lastAuditedAt: daysAgo(row.breakdownAudit), activity: 0, adjustments: 0, lastCount: null }, R), score: row.score };
        await prisma.binScore.create({ data: { binId: bin.id, score: row.score, formulaVersion: breakdown.formulaVersion, referenceAt: R, computedAt: R, breakdown } });
      }
    }
    // Never audited first (code order between them), then the oldest audit.
    expect((await top()).map((t) => t.binCode)).toEqual(['A-01-03', 'A-02-01', 'A-01-02', 'A-01-01', 'A-01-05']);
  });

  it('returns an empty list when no bin has a score', async () => {
    await clearInventory(prisma);
    expect(await top()).toEqual([]);
  });
});

import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { generateDemoData } from '../src/demo-data/generate.js';
import { HIGH_RISK_PLAN, HIGH_RISK_VERSION } from '../src/demo-data/high-risk.js';
import { resetDemoData } from '../src/demo-data/reset.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CAPS, WEIGHTS, priorityFor } from '../src/scoring/formula.js';
import { FIXED_REFERENCE, scoresInSql } from './support.js';

// The demo scenarios (D-017) against the PostgreSQL test database: the
// original demo is unchanged, and the high-risk scenario's planned spread
// (8 high, 12 medium, 10 low) comes out of the unchanged formula.
describe('Demo scenarios (PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('the original demo is byte-for-byte the data of generator v1 before the scenarios', () => {
    // Fingerprint taken on 2026-10-21 from the generator before this change.
    const { scenario, ...data } = generateDemoData({ reference: FIXED_REFERENCE });
    expect(scenario).toBe('standard');
    expect(createHash('sha256').update(JSON.stringify(data)).digest('hex')).toBe('4772127561d7384431453ae7cc14f6637ca0b35cec4aca6063ce4adf4af1a8b7');
  });

  it('the formula is the accepted one: same weights, caps and bands', () => {
    expect(WEIGHTS).toEqual({ age: 30, activity: 25, adjustments: 20, lastResult: 25 });
    expect(CAPS).toEqual({ ageDays: 90, activity: 40, adjustments: 5 });
    expect([69, 70, 39, 40].map(priorityFor)).toEqual(['medium', 'high', 'low', 'medium']);
  });

  it('high-risk: reproducible; 8 high, 12 medium, 10 low with different scores, equal to the formula in SQL and to the plan', async () => {
    const data = generateDemoData({ reference: FIXED_REFERENCE, scenario: 'high-risk' });
    expect(generateDemoData({ reference: new Date(FIXED_REFERENCE), scenario: 'high-risk' })).toEqual(data);
    expect(data.generatorVersion).toBe(HIGH_RISK_VERSION);
    const summary = await resetDemoData(prisma, data, { confirmReset: true });
    expect(summary.scenario).toBe('high-risk');
    expect(summary.scores.byPriority).toEqual({ high: 8, medium: 12, low: 10 });

    // The stored scores equal the formula written independently in SQL.
    const sql = await scoresInSql(prisma, FIXED_REFERENCE);
    const stored = await prisma.binScore.findMany({ include: { bin: true } });
    expect(stored.map((s) => [s.bin.code, s.score]).sort()).toEqual(sql.map((s) => [s.code, s.score]).sort());
    // ...and the planned scores, from the planned inputs, with no count result.
    expect(stored.map((s) => s.score).sort((a, b) => a - b)).toEqual(HIGH_RISK_PLAN.map((p) => p.score).sort((a, b) => a - b));
    for (const s of stored) {
      const f = (s.breakdown as any).factors;
      const plan = HIGH_RISK_PLAN.find((p) => p.score === s.score && p.activity === f.activity.input && p.adjustments === f.adjustments.input)!;
      expect(plan).toBeDefined();
      expect(f.age.neverAudited).toBe(plan.ageDays === null);
      if (plan.ageDays !== null) {
        expect(f.age.input).toBeCloseTo(plan.ageDays, 9);
      }
      expect(f.lastResult.contribution).toBe(0);
    }
    // Different scores within each band.
    const band = (lo: number, hi: number) => new Set(stored.filter((s) => s.score >= lo && s.score <= hi).map((s) => s.score)).size;
    expect([band(70, 100), band(40, 69), band(0, 39)]).toEqual([6, 12, 10]);

    // Coherent inventory: no negative or emptied-and-kept pallet, at most 4 per bin.
    expect(await prisma.pallet.count({ where: { quantity: { lt: 0 } } })).toBe(0);
    const perBin = await prisma.pallet.groupBy({ by: ['binId'], where: { binId: { not: null } }, _count: { _all: true } });
    expect(Math.max(...perBin.map((b) => b._count._all))).toBeLessThanOrEqual(4);

    const { body } = await request(app.getHttpServer()).get('/demo').expect(200);
    expect(body).toMatchObject({ scenario: 'high-risk', label: 'High-risk demo', generatorVersion: HIGH_RISK_VERSION, seed: 20261018, reference: FIXED_REFERENCE.toISOString() });
  });

  it('the original demo can be loaded again, and is shown as such; no row means not recorded', async () => {
    const summary = await resetDemoData(prisma, generateDemoData({ reference: FIXED_REFERENCE }), { confirmReset: true });
    expect(summary.scores.byPriority).toEqual({ high: 0, medium: 9, low: 21 });
    let r = await request(app.getHttpServer()).get('/demo').expect(200);
    expect(r.body).toMatchObject({ scenario: 'standard', label: 'Original demo' });
    expect(await prisma.demoDataset.count()).toBe(1);

    await prisma.demoDataset.deleteMany();
    r = await request(app.getHttpServer()).get('/demo').expect(200);
    expect(r.body).toEqual({ scenario: null, label: 'Scenario not recorded', generatorVersion: null, seed: null, reference: null, loadedAt: null });
  });

  it('the table holds one row at most', async () => {
    await expect(prisma.$executeRaw`INSERT INTO demo_dataset (id, scenario, generator_version, seed, reference_at, loaded_at) VALUES (2, 'standard', 1, 1, now(), now())`).rejects.toThrow();
  });
});

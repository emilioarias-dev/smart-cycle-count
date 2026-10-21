import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { generateDemoData } from '../src/demo-data/generate.js';
import { resetDemoData } from '../src/demo-data/reset.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CAPS, WEIGHTS, priorityFor } from '../src/scoring/formula.js';
import { FIXED_REFERENCE, scoresInSql } from './support.js';

// The demo scenarios (D-017) against the PostgreSQL test database: the
// original demo is unchanged, and the high-risk scenario reaches the high
// band with the unchanged formula.
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

  it('high-risk: reproducible, and some bins really in the high band next to medium and low ones', async () => {
    const data = generateDemoData({ reference: FIXED_REFERENCE, scenario: 'high-risk' });
    expect(generateDemoData({ reference: new Date(FIXED_REFERENCE), scenario: 'high-risk' })).toEqual(data);
    const summary = await resetDemoData(prisma, data, { confirmReset: true });
    expect(summary.scenario).toBe('high-risk');
    expect(summary.scores.byPriority).toEqual({ high: 4, medium: 3, low: 23 });

    // The stored scores equal the formula written independently in SQL.
    const sql = await scoresInSql(prisma, FIXED_REFERENCE);
    const stored = await prisma.binScore.findMany({ include: { bin: true } });
    expect(stored.map((s) => [s.bin.code, s.score]).sort()).toEqual(sql.map((s) => [s.code, s.score]).sort());
    const high = stored.filter((s) => s.score >= 70);
    expect(high.map((s) => s.bin.code).sort()).toEqual(['A-01-04', 'A-02-01', 'B-02-03', 'C-01-01']);
    // Each one by its inputs, without a count result: never audited, busy and
    // with adjustments in the 30 days before the reference.
    for (const s of high) {
      const f = (s.breakdown as any).factors;
      expect(f.age.neverAudited).toBe(true);
      expect(f.lastResult.contribution).toBe(0);
      expect(f.activity.input + f.adjustments.input).toBeGreaterThan(0);
    }

    const { body } = await request(app.getHttpServer()).get('/demo').expect(200);
    expect(body).toMatchObject({ scenario: 'high-risk', label: 'High-risk demo', generatorVersion: 1, seed: 20261018, reference: FIXED_REFERENCE.toISOString() });
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

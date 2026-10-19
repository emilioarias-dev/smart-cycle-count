import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { generateDemoData } from '../src/demo-data/generate.js';
import { resetDemoData } from '../src/demo-data/reset.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FIXED_REFERENCE, clearInventory } from './support.js';

// The plans API on the real Nest application and PostgreSQL test database.
describe('Audit plans API (PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const post = (body: unknown) => request(app.getHttpServer()).post('/audit-plans').send(body as object);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDemoData(prisma, generateDemoData({ reference: FIXED_REFERENCE }), { confirmReset: true });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('POST /audit-plans without N creates a plan of 5 with the copied scores', async () => {
    const { body } = await post({}).expect(201);
    expect(body.plan).toMatchObject({ requestedCount: 5, createdCount: 5, excluded: { pendingTask: 0, noScore: 0 } });
    expect(body.tasks.map((t: any) => [t.rank, t.binCode, t.score.value, t.score.label])).toEqual([
      [1, 'B-02-03', 68, 'Medium priority'],
      [2, 'C-01-01', 64, 'Medium priority'],
      [3, 'B-01-05', 57, 'Medium priority'],
      [4, 'A-02-01', 57, 'Medium priority'],
      [5, 'A-01-05', 54, 'Medium priority'],
    ]);
    expect(body.tasks.every((t: any) => t.score.reference === FIXED_REFERENCE.toISOString())).toBe(true);
  });

  it('POST /audit-plans rejects an invalid N with 400 and creates nothing', async () => {
    for (const n of [0, 31, -3, 2.5, '5', null, true, [5]]) {
      const { body } = await post({ n }).expect(400);
      expect(body).toMatchObject({ statusCode: 400, code: 'INVALID_N' });
    }
    expect(await prisma.auditPlan.count()).toBe(0);
  });

  it('POST /audit-plans answers 409 with distinct reasons when no plan can be created', async () => {
    await post({ n: 30 }).expect(201);
    const busy = await post({ n: 1 }).expect(409);
    expect(busy.body).toMatchObject({ code: 'NO_AVAILABLE_BINS', message: expect.stringMatching(/No bins are available/) });

    await clearInventory(prisma);
    await prisma.bin.create({ data: { code: 'A-01-01', aisle: 'A', rack: 1, position: 1 } });
    const unscored = await post({ n: 1 }).expect(409);
    expect(unscored.body).toMatchObject({ code: 'NO_SCORES', message: expect.stringMatching(/recompute/) });
  });

  it('GET /audit-tasks lists tasks newest plan first, with the plan summary and the copied score', async () => {
    await post({ n: 2 }).expect(201);
    await post({ n: 3 }).expect(201);
    // A recompute afterwards must not change the listed explanation.
    await request(app.getHttpServer()).post('/scores/recompute').expect(200);

    const { body } = await request(app.getHttpServer()).get('/audit-tasks').expect(200);
    expect(body.map((t: any) => [t.plan.id, t.rank, t.bin.code, t.status])).toEqual([
      [2, 1, 'B-01-05', 'PENDING'],
      [2, 2, 'A-02-01', 'PENDING'],
      [2, 3, 'A-01-05', 'PENDING'],
      [1, 1, 'B-02-03', 'PENDING'],
      [1, 2, 'C-01-01', 'PENDING'],
    ]);
    expect(body[0].plan).toMatchObject({ requestedCount: 3, createdCount: 3, excluded: { pendingTask: 2, noScore: 0 } });
    expect(body[0].score).toMatchObject({ value: 57, priority: 'medium', label: 'Medium priority', reference: FIXED_REFERENCE.toISOString(), formulaVersion: 2 });
    expect(body[0].completedAt).toBeNull();
  });
});

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { BinsService } from '../src/bins/bins.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SAMPLE_BIN_CODE, seedSampleBin } from '../src/sample-data.js';

// Runs the real Nest application against the real PostgreSQL test database.
describe('Bins API (PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.bin.deleteMany();
    await seedSampleBin(prisma);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('injects the Prisma service into the bins service', () => {
    const binsService = app.get(BinsService);
    expect(binsService['prisma']).toBe(prisma);
  });

  it('GET /bins/:code returns the stored bin', async () => {
    const response = await request(app.getHttpServer())
      .get(`/bins/${SAMPLE_BIN_CODE}`)
      .expect(200);

    expect(response.body).toEqual({
      id: expect.any(Number),
      code: SAMPLE_BIN_CODE,
    });
  });

  it('GET /bins/:code returns 404 for an unknown code', async () => {
    const response = await request(app.getHttpServer())
      .get('/bins/UNKNOWN-BIN')
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Bin UNKNOWN-BIN not found',
    });
  });

  it('seeding twice keeps exactly one sample bin', async () => {
    const first = await prisma.bin.findUniqueOrThrow({
      where: { code: SAMPLE_BIN_CODE },
    });
    const again = await seedSampleBin(prisma);

    expect(again.id).toBe(first.id);
    expect(await prisma.bin.count()).toBe(1);
  });
});

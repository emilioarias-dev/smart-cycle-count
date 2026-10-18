import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { BinsService } from '../src/bins/bins.service.js';
import { generateDemoData } from '../src/demo-data/generate.js';
import { resetDemoData } from '../src/demo-data/reset.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FIXED_REFERENCE } from './support.js';

// The real Nest application against the real PostgreSQL test database, loaded
// with the demo data.
describe('Warehouse and bins API (PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await resetDemoData(prisma, generateDemoData({ reference: FIXED_REFERENCE }), { confirmReset: true });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('injects the Prisma service into the bins service', () => {
    expect(app.get(BinsService)['prisma']).toBe(prisma);
  });

  it('GET /warehouse returns aisles → racks → bins in location order', async () => {
    const { body } = await request(app.getHttpServer()).get('/warehouse').expect(200);

    expect(body.aisles.map((a: { aisle: string }) => a.aisle)).toEqual(['A', 'B', 'C']);
    for (const aisle of body.aisles) {
      expect(aisle.racks.map((r: { rack: number }) => r.rack)).toEqual([1, 2]);
      for (const rack of aisle.racks) {
        expect(rack.bins.map((b: { position: number }) => b.position)).toEqual([1, 2, 3, 4, 5]);
        for (const bin of rack.bins) {
          expect(bin.code).toBe(`${aisle.aisle}-0${rack.rack}-0${bin.position}`);
        }
      }
    }
    const listed = body.aisles.flatMap((a: any) => a.racks.flatMap((r: any) => r.bins));
    const palletTotal = listed.reduce((sum: number, b: { palletCount: number }) => sum + b.palletCount, 0);
    expect(palletTotal).toBe(await prisma.pallet.count({ where: { binId: { not: null } } }));
  });

  it('GET /bins/:code returns the bin with its current pallets, products and antecedents', async () => {
    const stored = await prisma.bin.findFirstOrThrow({
      where: { pallets: { some: {} } },
      orderBy: { code: 'asc' },
      include: { pallets: { orderBy: { code: 'asc' }, include: { product: true } } },
    });
    const { body } = await request(app.getHttpServer()).get(`/bins/${stored.code}`).expect(200);

    expect(body).toEqual({
      code: stored.code,
      aisle: stored.aisle,
      rack: stored.rack,
      position: stored.position,
      inventoryVersion: stored.inventoryVersion,
      lastAuditedAt: stored.lastAuditedAt?.toISOString() ?? null,
      pallets: stored.pallets.map((p) => ({
        code: p.code,
        quantity: p.quantity,
        product: { sku: p.product.sku, name: p.product.name, unit: p.product.unit },
      })),
    });
    expect(body.pallets.length).toBeGreaterThan(0);
    expect(body.pallets.every((p: { quantity: number }) => p.quantity > 0)).toBe(true);
  });

  it('GET /bins/:code returns an empty pallet list for an empty bin', async () => {
    const empty = await prisma.bin.findFirstOrThrow({ where: { pallets: { none: {} } } });
    const { body } = await request(app.getHttpServer()).get(`/bins/${empty.code}`).expect(200);
    expect(body.pallets).toEqual([]);
  });

  it('GET /bins/:code normalises spaces and lower case', async () => {
    const { body } = await request(app.getHttpServer()).get('/bins/%20a-01-03%20').expect(200);
    expect(body.code).toBe('A-01-03');
  });

  it('GET /bins/:code returns 404 for an unknown code', async () => {
    const { body } = await request(app.getHttpServer()).get('/bins/z-99-99').expect(404);
    expect(body).toMatchObject({ statusCode: 404, message: 'Bin Z-99-99 not found' });
  });
});

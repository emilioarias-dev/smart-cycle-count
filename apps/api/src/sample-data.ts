import type { PrismaClient } from './generated/prisma/client.js';

// Milestone 1 sample data: a single, clearly labelled example bin. The real
// bin code format and warehouse layout are still to be decided.
export const SAMPLE_BIN_CODE = 'SAMPLE-BIN-01';

// Idempotent: running it again leaves exactly one sample bin.
export async function seedSampleBin(prisma: PrismaClient) {
  return prisma.bin.upsert({
    where: { code: SAMPLE_BIN_CODE },
    update: {},
    create: { code: SAMPLE_BIN_CODE },
  });
}

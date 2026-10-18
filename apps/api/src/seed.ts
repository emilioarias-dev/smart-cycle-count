// Inserts the milestone 1 sample data. Run with `npm run db:seed`, which
// compiles this file into dist-seed/ and runs it.
import 'dotenv/config';
import { PrismaService } from './prisma/prisma.service.js';
import { seedSampleBin } from './sample-data.js';

const prisma = new PrismaService();
try {
  const bin = await seedSampleBin(prisma);
  const total = await prisma.bin.count();
  console.log(`Sample bin ready: ${bin.code} (id ${bin.id}). Bins in database: ${total}.`);
} finally {
  await prisma.$disconnect();
}

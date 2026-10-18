import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Runs once before the API tests: brings the separate test database up to
// date with the committed migrations. It refuses to touch the development
// database, because the tests delete rows.
export default function setup(): void {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env.',
    );
  }
  const devUrl = process.env.DATABASE_URL;
  if (devUrl && databaseName(devUrl) === databaseName(testUrl)) {
    throw new Error(
      'TEST_DATABASE_URL must point to a different database than DATABASE_URL.',
    );
  }

  // Call the Prisma CLI through Node so this works the same on Windows and Linux.
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });
}

function databaseName(url: string): string {
  const { host, pathname } = new URL(url);
  return `${host}${pathname}`;
}

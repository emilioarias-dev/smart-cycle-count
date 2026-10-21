// node --test: how the API client classifies the answers to a write (D-018),
// against a local HTTP server that plays each case. A write whose outcome is
// unknown is never reported as "nothing was done".
import assert from 'node:assert/strict';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createPlan, submitCount } from './api.ts';

type Play = 'created' | 'rejected' | '502' | 'truncated' | 'incomplete' | 'cut';
let play: Play = 'created';
let server: Server;

const plan = { plan: { id: 7, requestedCount: 5, createdCount: 5, excluded: { pendingTask: 0, noScore: 0 }, createdAt: '2026-10-18T12:00:00.000Z' }, tasks: [] };
const count = { recovered: false, count: { id: 1, taskId: 1, bin: { code: 'A-01-01' }, result: 'PASS', countedAt: '2026-10-18T12:00:00.000Z', inventoryVersion: 1, lines: [], unexpected: [] }, score: null };

before(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const ok = req.url?.startsWith('/audit-plans') ? plan : count;
      if (play === 'created') return json(201, ok);
      if (play === 'rejected') return json(409, { code: 'NO_AVAILABLE_BINS', message: 'No bin is available for a new plan.' });
      if (play === '502') return json(502, { message: 'Bad gateway' });
      if (play === 'incomplete') return json(201, { recovered: false });
      if (play === 'truncated') {
        res.writeHead(201, { 'content-type': 'application/json' });
        return res.end('{"plan":{"id":');
      }
      req.socket.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.API_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('API client: answers to a write', () => {
  const quiet = console.error;
  before(() => (console.error = () => {}));
  after(() => (console.error = quiet));

  it('a plan: created, rejected (fix the input), and three unknown outcomes', async () => {
    play = 'created';
    assert.equal((await createPlan(5)).status, 'ok');
    play = 'rejected';
    assert.deepEqual(await createPlan(5), { status: 'error', kind: 'rejected', reason: 'No bin is available for a new plan.' });
    for (const [p, reason] of [
      ['502', 'The API responded with HTTP 502. It is not known whether this was done.'],
      ['truncated', "The API's answer could not be read. It is not known whether this was done."],
    ] as const) {
      play = p;
      assert.deepEqual(await createPlan(5), { status: 'error', kind: 'unconfirmed', responded: true, reason }, p);
    }
    play = 'cut';
    assert.deepEqual(await createPlan(5), { status: 'error', kind: 'unconfirmed', reason: 'The API did not answer. It is not known whether this was done.' });
  });

  it('a refused connection sent nothing: failed, safe to retry', async () => {
    // A port that was just freed: nothing listens there.
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const base = process.env.API_BASE_URL;
    process.env.API_BASE_URL = `http://127.0.0.1:${port}`;
    const result = await createPlan(5);
    process.env.API_BASE_URL = base;
    assert.equal(result.status === 'error' && result.kind, 'failed');
  });

  it('a count: saved only with a readable count; 502, a cut-off or incomplete body and a cut are unknown', async () => {
    play = 'created';
    assert.equal((await submitCount(1, { inventoryVersion: 1, lines: [], unexpected: [] })).status, 'saved');
    for (const p of ['502', 'truncated', 'incomplete', 'cut'] as const) {
      play = p;
      assert.equal((await submitCount(1, { inventoryVersion: 1, lines: [], unexpected: [] })).status, 'unconfirmed', p);
    }
  });
});

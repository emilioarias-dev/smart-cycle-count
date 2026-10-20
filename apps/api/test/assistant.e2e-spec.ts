import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TOOL_NAMES } from '../src/assistant/tools.js';
import { BinsService } from '../src/bins/bins.service.js';
import { openCountSheet } from '../src/counting/sheet.js';
import { submitCount } from '../src/counting/submit.js';
import { generateDemoData } from '../src/demo-data/generate.js';
import { resetDemoData } from '../src/demo-data/reset.js';
import { createPlan } from '../src/planning/create-plan.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FIXED_REFERENCE } from './support.js';

// Rivy against a SIMULATED Gemini: a local HTTP server returns scripted
// replies and records every request. Real Gemini runs are recorded apart
// (VERIFICATION.md). The tools run against the PostgreSQL test database.

type Scripted = { status?: number; body?: unknown; delayMs?: number };
type Recorded = { headers: Record<string, string | string[] | undefined>; url: string; body: any };

describe('Rivy assistant with a simulated Gemini (PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let bins: BinsService;
  let gemini: Server;
  let script: Scripted[] = [];
  let requests: Recorded[] = [];
  const env = { ...process.env };

  const ask = (body: unknown) => request(app.getHttpServer()).post('/assistant/ask').send(body as object);
  const call = (name: string, args: Record<string, unknown>, id = `call_${name}`) => ({
    candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args, id }, thoughtSignature: `sig-${name}` }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 },
  });
  const calls = (...list: [string, Record<string, unknown>][]) => ({
    candidates: [{ content: { role: 'model', parts: list.map(([name, args], i) => ({ functionCall: { name, args, id: `c${i}` } })) }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30, totalTokenCount: 130 },
  });
  const text = (t: string) => ({
    candidates: [{ content: { role: 'model', parts: [{ text: t }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 50, totalTokenCount: 250 },
  });
  // What the backend returned to the model in the second call.
  const toolResponses = () => requests[1].body.contents.at(-1).parts.map((p: any) => p.functionResponse);

  beforeAll(async () => {
    gemini = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        requests.push({ headers: req.headers, url: req.url ?? '', body: JSON.parse(raw || '{}') });
        const next = script.shift() ?? { status: 500, body: { error: { status: 'INTERNAL', message: 'no scripted reply' } } };
        setTimeout(() => {
          if (res.destroyed) return;
          res.writeHead(next.status ?? 200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(next.body ?? {}));
        }, next.delayMs ?? 0);
      });
    });
    await new Promise<void>((resolve) => gemini.listen(0, '127.0.0.1', resolve));
    process.env.GEMINI_API_BASE = `http://127.0.0.1:${(gemini.address() as AddressInfo).port}/v1beta`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    bins = app.get(BinsService);
    await resetDemoData(prisma, generateDemoData({ reference: FIXED_REFERENCE }), { confirmReset: true });
  });

  beforeEach(() => {
    script = [];
    requests = [];
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.GEMINI_KEY_VIA_PROXY;
    delete process.env.GEMINI_MODEL;
    // The per-minute guard has its own test (with a fresh app).
    process.env.GEMINI_RPM = '1000';
    delete process.env.RIVY_CALL_TIMEOUT_MS;
    delete process.env.RIVY_TOTAL_TIMEOUT_MS;
  });

  afterAll(async () => {
    Object.assign(process.env, env);
    await app?.close();
    await new Promise((resolve) => gemini?.close(resolve));
  });

  it('explains a bin: get_bin returns the stored score and breakdown; one tool round, two calls, limits in every request', async () => {
    script = [{ body: call('get_bin', { code: ' b-02-03 ' }) }, { body: text('B-02-03 is Medium (68) — see /bins/B-02-03.') }];
    const { body } = await ask({ question: 'Why is B-02-03 a priority?', history: [] }).expect(200);

    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe('/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(requests[0].headers['x-goog-api-key']).toBe('test-key');
    for (const r of requests) {
      expect(r.body.generationConfig.maxOutputTokens).toBe(800);
      expect(r.body.tools[0].functionDeclarations.map((d: any) => d.name)).toEqual([...TOOL_NAMES]);
    }
    expect(requests[0].body.toolConfig.functionCallingConfig.mode).toBe('AUTO');
    expect(requests[1].body.toolConfig.functionCallingConfig.mode).toBe('NONE');
    // The model's turn goes back unchanged, with its thought signature.
    expect(requests[1].body.contents.at(-2)).toEqual({ role: 'model', parts: [{ functionCall: { name: 'get_bin', args: { code: ' b-02-03 ' }, id: 'call_get_bin' }, thoughtSignature: 'sig-get_bin' }] });

    const [response] = toolResponses();
    expect(response).toMatchObject({ name: 'get_bin', id: 'call_get_bin' });
    const stored = (await bins.findByCode('B-02-03'))!;
    expect(response.response).toMatchObject({
      found: true,
      code: 'B-02-03',
      currentScore: { value: stored.score!.value, band: stored.score!.label, scoreTime: stored.score!.reference.toISOString(), formulaVersion: 2 },
      links: [{ label: 'Bin B-02-03', href: '/bins/B-02-03' }],
    });
    const points = response.response.currentScore.factors.map((f: any) => f.points);
    const { age, activity, adjustments, lastResult } = stored.score!.breakdown.factors;
    expect(points).toEqual([age, activity, adjustments, lastResult!].map((f) => Math.round(f.contribution * 100) / 100));
    expect(response.response.pallets).toHaveLength(stored.pallets.length);

    expect(body).toMatchObject({
      answer: 'B-02-03 is Medium (68) — see /bins/B-02-03.',
      references: [{ label: 'Bin B-02-03', href: '/bins/B-02-03' }],
      tools: [{ name: 'get_bin', args: { code: ' b-02-03 ' } }],
      model: 'gemini-3.5-flash-lite',
      usage: { modelCalls: 2, promptTokens: 300, outputTokens: 70, totalTokens: 370 },
      truncated: false,
    });
    expect(body.queriedAt).toBe(response.response.queriedAt);
  });

  it('compares two bins with the accepted tie-break, and tells priority apart from availability for a new plan', async () => {
    script = [{ body: call('compare_bins', { first: 'A-02-01', second: 'B-01-05' }) }, { body: text('B-01-05 first.') }];
    await ask({ question: 'Compare A-02-01 and B-01-05', history: [] }).expect(200);
    let [response] = toolResponses();
    expect(response.response).toMatchObject({ found: true, higherPriority: 'B-01-05' });
    expect(response.response.decidedBy).toBe('tie at 57: B-01-05 was never audited');
    expect(response.response.bins.map((b: any) => [b.code, b.currentScore.value, b.forNewPlan])).toEqual([
      ['A-02-01', 57, 'Available for a new plan.'],
      ['B-01-05', 57, 'Available for a new plan.'],
    ]);

    // With a plan of 3 (B-02-03, C-01-01, B-01-05 pending): same priority, but
    // B-01-05 cannot go into another plan.
    await createPlan(prisma, 3);
    requests = [];
    script = [{ body: call('compare_bins', { first: 'A-02-01', second: 'B-01-05' }) }, { body: text('ok') }];
    await ask({ question: 'And now?', history: [] }).expect(200);
    [response] = toolResponses();
    expect(response.response.higherPriority).toBe('B-01-05');
    expect(response.response.bins[1].forNewPlan).toBe('Not available for a new plan: it already has a pending task.');
  });

  it('reads the count history: score at selection, count result and variances in units, apart from the current score', async () => {
    // B-02-03 is pending (plan above); count it with one case missing.
    const sheet = await openCountSheet(prisma, 'B-02-03');
    await submitCount(prisma, sheet.task.id, {
      inventoryVersion: sheet.inventoryVersion,
      lines: sheet.lines.map((l, i) => ({ palletCode: l.palletCode, countedQuantity: l.expectedQuantity - (i === 0 ? 2 : 0) })),
      unexpected: [],
    });
    script = [{ body: call('get_bin_history', { code: 'B-02-03' }) }, { body: text('FAIL') }];
    const { body } = await ask({ question: 'Show the counts of B-02-03', history: [] }).expect(200);
    const [response] = toolResponses();
    const current = await prisma.binScore.findFirstOrThrow({ where: { bin: { code: 'B-02-03' } } });
    expect(response.response.currentScore).toEqual({ value: current.score, scoreTime: current.referenceAt.toISOString() });
    expect(response.response.tasks).toHaveLength(1);
    const [task] = response.response.tasks;
    expect(task).toMatchObject({ status: 'DONE', scoreAtSelection: { value: 68, band: 'medium', scoreTime: FIXED_REFERENCE.toISOString() }, count: { result: 'FAIL' } });
    expect(task.count.lines[0]).toEqual({ pallet: sheet.lines[0].palletCode, sku: sheet.lines[0].product.sku, unit: sheet.lines[0].product.unit, expected: sheet.lines[0].expectedQuantity, counted: sheet.lines[0].expectedQuantity - 2, variance: -2 });
    expect(task.count.lines.slice(1).every((l: any) => l.variance === 0)).toBe(true);
    expect(body.references).toEqual([{ label: 'Bin B-02-03', href: '/bins/B-02-03' }, { label: 'Tasks', href: '/tasks' }]);
  });

  it('answers rule questions from the versioned summary', async () => {
    script = [{ body: call('get_rules', { topic: 'score' }) }, { body: text('rules') }];
    await ask({ question: 'How is the score computed?', history: [] }).expect(200);
    const [response] = toolResponses();
    expect(response.response.rulesVersion).toBe('2026-10-20 (score formula v2)');
    expect(Object.keys(response.response.rules)).toEqual(['score']);
    expect(response.response.rules.score[0]).toContain('weight 30');
  });

  it('a bin that does not exist, and a bin without history (unknown, not PASS)', async () => {
    script = [{ body: calls(['get_bin', { code: 'Z-99-99' }], ['get_bin_history', { code: 'C-02-05' }]) }, { body: text('Z-99-99 does not exist; C-02-05 has no history.') }];
    const { body } = await ask({ question: 'Z-99-99 and the history of C-02-05?', history: [] }).expect(200);
    const [missing, empty] = toolResponses();
    expect(missing.response).toMatchObject({ found: false, code: 'Z-99-99' });
    expect(empty.response).toMatchObject({ found: true, code: 'C-02-05', tasks: [], note: 'No audit task or count is stored for this bin: its count history is unknown, not PASS.' });
    expect(body.tools.map((t: any) => t.name)).toEqual(['get_bin', 'get_bin_history']);
  });

  it('a write request: there is no write tool, an attempted one is refused and nothing changes', async () => {
    const before = await Promise.all([prisma.auditPlan.count(), prisma.auditTask.count(), prisma.count.count(), prisma.movement.count(), prisma.binScore.findMany({ orderBy: { binId: 'asc' } })]);
    script = [{ body: call('create_plan', { n: 5 }) }, { body: text('I am read-only: use Create plan on the Warehouse page.') }];
    const { body } = await ask({ question: 'Create a plan of 5 bins', history: [] }).expect(200);
    const [response] = toolResponses();
    expect(response.response).toEqual({ error: 'UNKNOWN_TOOL', message: 'There is no tool "create_plan". Rivy is read-only.' });
    expect(body.answer).toContain('read-only');
    const after = await Promise.all([prisma.auditPlan.count(), prisma.auditTask.count(), prisma.count.count(), prisma.movement.count(), prisma.binScore.findMany({ orderBy: { binId: 'asc' } })]);
    expect(after).toEqual(before);
  });

  it('sends the last exchanges as text only (no earlier tool data), the new question last', async () => {
    const history = Array.from({ length: 6 }, (_, i) => ({ question: `q${i}`, answer: i === 5 ? 'x'.repeat(2500) : `a${i}` }));
    script = [{ body: text('Hola') }];
    const { body } = await ask({ question: '¿Y el bin A-01-01?', history }).expect(200);
    const contents = requests[0].body.contents;
    expect(contents).toHaveLength(13);
    expect(contents[0]).toEqual({ role: 'user', parts: [{ text: 'q0' }] });
    expect(contents[11].parts[0].text).toHaveLength(2000);
    expect(contents[12]).toEqual({ role: 'user', parts: [{ text: '¿Y el bin A-01-01?' }] });
    expect(requests[0].body.systemInstruction.parts[0].text).toContain('Answer in the language of the question (English if unclear)');
    expect(requests[0].body.systemInstruction.parts[0].text).toContain('Earlier answers in this conversation may be outdated');
    expect(body).toMatchObject({ answer: 'Hola', usage: { modelCalls: 1 }, tools: [], references: [] });
  });

  it('limits: question and history size checked before any call; at most 2 tool runs and 2 model calls', async () => {
    let r = await ask({ question: 'x'.repeat(501), history: [] }).expect(400);
    expect(r.body).toMatchObject({ code: 'INVALID_QUESTION', retryable: false });
    r = await ask({ question: 'hi', history: Array.from({ length: 7 }, () => ({ question: 'q', answer: 'a' })) }).expect(400);
    expect(r.body.code).toBe('INVALID_QUESTION');
    await ask({ question: '   ', history: [] }).expect(400);
    expect(requests).toHaveLength(0);

    script = [{ body: calls(['get_rules', { topic: 'score' }], ['get_rules', { topic: 'plans' }], ['get_bin', { code: 'A-01-01' }]) }, { body: text('done') }];
    const ok = await ask({ question: 'Three tools', history: [] }).expect(200);
    expect(ok.body.tools).toHaveLength(2);
    expect(toolResponses()[2].response).toEqual({ error: 'LIMIT', message: 'Only 2 tool calls per question.' });

    requests = [];
    script = [{ body: call('get_rules', { topic: 'all' }) }, { body: call('get_bin', { code: 'A-01-01' }) }];
    r = await ask({ question: 'Keeps calling tools', history: [] }).expect(502);
    expect(r.body.code).toBe('LIMIT');
    expect(requests).toHaveLength(2);
  });

  it('Gemini errors become clear answers: 429 quota, 503, timeout, refused key, blocked; the rest of the API keeps working', async () => {
    script = [{ status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } } }];
    let r = await ask({ question: 'q', history: [] }).expect(429);
    expect(r.body).toMatchObject({ code: 'QUOTA', retryable: true, message: 'Gemini quota or rate limit reached (429 RESOURCE_EXHAUSTED). Try again later.' });

    script = [{ status: 503, body: { error: { code: 503, status: 'UNAVAILABLE', message: 'This model is currently experiencing high demand.' } } }];
    r = await ask({ question: 'q', history: [] }).expect(503);
    expect(r.body).toMatchObject({ code: 'UNAVAILABLE', retryable: true });

    process.env.RIVY_CALL_TIMEOUT_MS = '200';
    script = [{ delayMs: 1000, body: text('late') }];
    r = await ask({ question: 'q', history: [] }).expect(504);
    expect(r.body).toMatchObject({ code: 'TIMEOUT', message: 'Gemini did not answer in time.' });
    delete process.env.RIVY_CALL_TIMEOUT_MS;

    // The whole question also has a deadline (two slow calls).
    process.env.RIVY_TOTAL_TIMEOUT_MS = '600';
    script = [{ delayMs: 400, body: call('get_rules', { topic: 'all' }) }, { delayMs: 400, body: text('late') }];
    r = await ask({ question: 'q', history: [] }).expect(504);
    expect(r.body.code).toBe('TIMEOUT');
    delete process.env.RIVY_TOTAL_TIMEOUT_MS;

    script = [{ status: 400, body: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } } }];
    r = await ask({ question: 'q', history: [] }).expect(502);
    expect(r.body).toMatchObject({ code: 'AUTH', retryable: false });

    script = [{ body: { promptFeedback: { blockReason: 'SAFETY' } } }];
    r = await ask({ question: 'q', history: [] }).expect(502);
    expect(r.body.code).toBe('BLOCKED');

    await request(app.getHttpServer()).get('/warehouse').expect(200);
    await request(app.getHttpServer()).get('/bins/A-01-01').expect(200);
  });

  it('without a key nothing is sent; the local rate guard stops before Gemini would', async () => {
    delete process.env.GEMINI_API_KEY;
    let r = await ask({ question: 'q', history: [] }).expect(503);
    expect(r.body).toMatchObject({ code: 'NOT_CONFIGURED', retryable: false, message: 'Rivy is not configured: set GEMINI_API_KEY in apps/api/.env and restart the API.' });
    expect(requests).toHaveLength(0);

    // A fresh app so that the per-minute window starts empty.
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_RPM = '3';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const other = moduleRef.createNestApplication();
    await other.init();
    try {
      script = [{ body: call('get_rules', { topic: 'all' }) }, { body: text('one') }, { body: text('two') }];
      await request(other.getHttpServer()).post('/assistant/ask').send({ question: 'a', history: [] }).expect(200);
      await request(other.getHttpServer()).post('/assistant/ask').send({ question: 'b', history: [] }).expect(200);
      r = await request(other.getHttpServer()).post('/assistant/ask').send({ question: 'c', history: [] }).expect(429);
      expect(r.body).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
      expect(r.body.retryAfterSeconds).toBeGreaterThan(0);
      expect(requests).toHaveLength(3);
    } finally {
      await other.close();
    }
  });
});

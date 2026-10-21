// Ambiguous answers when creating a plan (audit, point 2). Production build;
// the API on :3002 behind the scratch proxy on :3001 (`mode` file).
const os = require('os');
const path = require('path');
// Runtime state (proxy and Gemini modes, request log), outside the repository.
const STATE = process.env.CHECKS_STATE ?? path.join(os.tmpdir(), 'scc-browser-checks');
require('fs').mkdirSync(STATE, { recursive: true });
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const D = __dirname;
const B = 'http://localhost:3000';
const setMode = (m) => fs.writeFileSync(path.join(STATE, 'mode'), m);
const plans = async () => (await (await fetch('http://localhost:3002/audit-tasks')).json()).reduce((m, t) => Math.max(m, t.plan.id), 0);
const posts = () => (fs.existsSync(path.join(STATE, 'requests.log')) ? fs.readFileSync(path.join(STATE, 'requests.log'), 'utf8').split('\n').filter((l) => l.includes('POST /audit-plans')).length : 0);
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d !== '' ? ' — ' + d : ''}`); };
const proxyDown = () => execSync('fuser -k 3001/tcp >/dev/null 2>&1 || true');
const proxyUp = () => {
  execSync(`nohup node ${D}/proxy.cjs > ${path.join(STATE, 'proxy.log')} 2>&1 &`);
  execSync('for i in $(seq 1 20); do curl -s -o /dev/null localhost:3001/warehouse && break; sleep 0.3; done');
};

(async () => {
  setMode('pass');
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(B + '/');
  const toast = () => p.locator('.toast').last();
  const create = async (n) => {
    await p.fill('#plan-size', String(n));
    await p.click('form .btn-primary[type=submit]');
  };
  const settled = () => p.waitForFunction(() => !document.querySelector('form .btn-primary[aria-busy="true"]'), null, { timeout: 40000 });

  // 1. Saved, but the answer is a 502.
  for (const [mode, name] of [['502-after-post', 'saved, then 502'], ['truncated-post', 'saved, then a cut-off success body']]) {
    setMode(mode);
    const before = await plans();
    await create(1);
    await settled().catch(() => {});
    await p.waitForTimeout(400);
    const text = (await toast().innerText().catch(() => '(no toast)')).replace(/\s+/g, ' ');
    const retry = await toast().locator('button:has-text("Retry")').count().catch(() => 0);
    const created = (await plans()) - before;
    ok(created === 1 && text.includes('not confirmed') && !text.includes('No plan created') && retry === 0 && text.includes('Tasks'), `${name}: the plan exists; the page says "not confirmed", no Retry, Tasks link`, `created ${created}; "${text.slice(0, 110)}"; retry ${retry}`);
    setMode('pass');
  }

  // 2. The Server Action's own answer is lost (browser → Next.js).
  const before = await plans();
  await p.route('**/*', (route) => (route.request().method() === 'POST' && route.request().headers()['next-action'] ? route.abort('connectionreset') : route.continue()));
  await create(1);
  await p.waitForTimeout(1500);
  await p.unroute('**/*');
  const text = (await toast().innerText().catch(() => '(no toast)')).replace(/\s+/g, ' ');
  const page = await p.locator('h1').innerText().catch(() => '(no h1)');
  ok(text.includes('not confirmed') && !text.includes('No plan created') && page.includes('Warehouse'), 'Server Action answer lost: "not confirmed", the page keeps working', `"${text.slice(0, 100)}"; h1 "${page}"; errors ${errors.length}; created ${(await plans()) - before}`);
  await p.goto(B + '/');

  // 3. Retry pressed twice while pending: one request.
  proxyDown();
  await create(1);
  await p.waitForSelector('.toast.error button:has-text("Retry")');
  proxyUp();
  setMode('slow-post');
  const sent = posts();
  const retry = p.locator('.toast.error button:has-text("Retry")');
  await retry.click();
  await retry.click({ timeout: 1000 }).catch(() => {});
  await retry.click({ timeout: 1000 }).catch(() => {});
  await settled();
  await p.waitForTimeout(500);
  ok(posts() - sent === 1, 'Retry pressed three times while pending: one request', `${posts() - sent} POSTs`);
  setMode('pass');

  console.log('page errors:', errors.length ? errors : 'none');
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

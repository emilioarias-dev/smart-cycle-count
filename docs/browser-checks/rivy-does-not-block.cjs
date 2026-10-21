// Does a slow Rivy question hold back another action (audit, point 6)?
// Gemini SIMULATED and slow (40 s; the API gives up after 30 s). The proxy
// in front of the API logs when each request arrives.
const os = require('os');
const path = require('path');
// Runtime state (proxy and Gemini modes, request log), outside the repository.
const STATE = process.env.CHECKS_STATE ?? path.join(os.tmpdir(), 'scc-browser-checks');
require('fs').mkdirSync(STATE, { recursive: true });
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const fs = require('fs');
const D = __dirname;
const B = 'http://localhost:3000';
const setGemini = (m) => fs.writeFileSync(path.join(STATE, 'gemini-mode'), m);
const log = () => (fs.existsSync(path.join(STATE, 'requests.log')) ? fs.readFileSync(path.join(STATE, 'requests.log'), 'utf8').trim().split('\n') : []);
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d !== '' ? ' — ' + d : ''}`); };

(async () => {
  fs.writeFileSync(path.join(STATE, 'mode'), 'pass');
  setGemini('slow');
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto(B + '/');
  await p.waitForLoadState('networkidle');
  const start = log().length;
  const t0 = Date.now();
  await p.click('.rivy-button');
  await p.fill('#rivy-question', 'How is the risk score calculated?');
  await p.press('#rivy-question', 'Enter');
  await p.waitForTimeout(1500);
  await p.fill('#plan-size', '1');
  const pressed = Date.now() - t0;
  await p.click('form .btn-primary[type=submit]');
  await p.waitForSelector('.toast', { timeout: 60000 });
  const toastAt = Date.now() - t0;
  const lines = log().slice(start);
  const at = (needle) => {
    const line = lines.find((l) => l.includes(needle));
    return line ? new Date(line.split(' ')[0]).getTime() - t0 : null;
  };
  const ask = at('POST /assistant/ask');
  const plan = at('POST /audit-plans');
  console.log(JSON.stringify({ askArrived: ask, createPressed: pressed, planArrived: plan, planResultShown: toastAt }));
  ok(plan !== null && plan - pressed < 3000, 'Create plan reaches the API while Rivy waits for Gemini', `pressed at ${pressed} ms, arrived at ${plan} ms`);
  ok(toastAt - pressed < 5000, 'its result is shown without waiting for Rivy', `shown at ${toastAt} ms`);
  // A Gemini timeout does not stop the app: Rivy says so, the app keeps going.
  await p.waitForSelector('.rivy-panel [role=alert]', { timeout: 60000 });
  const message = await p.locator('.rivy-panel [role=alert]').innerText();
  await p.click('.nav a[href="/tasks"]');
  await p.waitForURL('**/tasks');
  ok(/did not answer in time/.test(message) && (await p.locator('h1').innerText()).includes('Tasks'), 'after a Gemini timeout: a clear message, and the app keeps working', message.split('\n')[1]);
  setGemini('ok');
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

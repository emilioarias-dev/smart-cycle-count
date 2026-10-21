// Exact retry of a count (audit, point 3). Production build; the API on :3002
// behind the scratch proxy on :3001 (`mode` file). Two pending bins needed.
const os = require('os');
const path = require('path');
// Runtime state (proxy and Gemini modes, request log), outside the repository.
const STATE = process.env.CHECKS_STATE ?? path.join(os.tmpdir(), 'scc-browser-checks');
require('fs').mkdirSync(STATE, { recursive: true });
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const fs = require('fs');
const D = __dirname;
const B = 'http://localhost:3000';
const API = 'http://localhost:3002';
const setMode = (m) => fs.writeFileSync(path.join(STATE, 'mode'), m);
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d !== '' ? ' — ' + d : ''}`); };
const tasks = async () => (await (await fetch(API + '/audit-tasks')).json());

(async () => {
  setMode('pass');
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const pending = (await tasks()).filter((t) => t.status === 'PENDING').map((t) => t.bin.code);
  const open = async (code) => {
    await p.goto(`${B}/count?bin=${code}`);
    await p.waitForSelector('.submit-bar');
    const inputs = await p.locator('.count-line input').all();
    const expected = [];
    for (const input of inputs) {
      const value = await input.evaluate((el) => el.closest('.count-line').querySelector('.num').textContent.match(/\d+/)[0]);
      expected.push(Number(value));
      await input.fill(value);
    }
    return { inputs, expected };
  };
  const stored = async (code) => {
    const t = (await tasks()).find((x) => x.bin.code === code && x.count);
    return t ? t.count.result : null;
  };
  const storedLines = async (code) => {
    const sheet = await (await fetch(`${API}/audit-tasks`)).json();
    const task = sheet.find((x) => x.bin.code === code && x.count);
    return task ? task : null;
  };

  // A. Cut before saving, then a quantity is changed, then "send the same".
  let code = pending[0];
  let { inputs, expected } = await open(code);
  setMode('reset');
  await p.click('.submit-bar button[type=submit]');
  await p.waitForSelector('text=Result unknown');
  setMode('pass');
  const edit = await inputs[0].evaluate((el) => !el.readOnly && !el.disabled);
  if (edit) {
    await inputs[0].fill(String(expected[0] + 1));
  }
  const same = p.locator('button:has-text("Send the same count again")');
  await same.click();
  await p.waitForSelector('#count-result-title, .callout.error', { timeout: 20000 });
  const result = await p.locator('.result-badge').first().innerText().catch(() => '(none)');
  ok(result.includes('PASS'), `A. cut before saving, quantity changed, "send the same": the count sent first is what is saved (PASS)`, `editable after unknown: ${edit}; saved: ${result}`);

  // B. Saved, answer lost; change a quantity; "send the same" → recovered.
  code = pending[1];
  ({ inputs, expected } = await open(code));
  setMode('drop-post');
  await p.click('.submit-bar button[type=submit]');
  await p.waitForSelector('text=Result unknown');
  setMode('pass');
  if (await inputs[0].evaluate((el) => !el.readOnly && !el.disabled)) {
    await inputs[0].fill(String(expected[0] + 1));
  }
  await p.locator('button:has-text("Send the same count again")').click();
  await p.waitForSelector('#count-result-title', { timeout: 20000 });
  const recovered = (await p.locator('.toast.info').innerText().catch(() => '')).includes('Recovered');
  const already = await p.locator('text=Already counted').count();
  ok(recovered && already === 0, 'B. saved, answer lost, quantity changed, "send the same": the saved count comes back as recovered', `recovered ${recovered}; "Already counted" ${already}`);

  // C. While sending, the fields cannot be changed.
  code = pending[2];
  ({ inputs, expected } = await open(code));
  setMode('slow-post');
  await p.click('.submit-bar button[type=submit]');
  await p.waitForTimeout(300);
  const locked = await inputs[0].evaluate((el) => el.readOnly || el.disabled);
  // Typing into the field while sending (a read-only field ignores it).
  await inputs[0].focus();
  await p.keyboard.type('5');
  const shownWhileSending = await inputs[0].inputValue();
  await p.waitForSelector('#count-result-title', { timeout: 20000 });
  setMode('pass');
  ok(locked && shownWhileSending === String(expected[0]), 'C. while sending, the quantities cannot be changed', `locked ${locked}; field shows ${shownWhileSending}, sent ${expected[0]}`);

  // D. Saved, answer lost; the operator chooses "Change quantities": a new
  // count, which the API rejects without overwriting the saved one.
  code = pending[3];
  ({ inputs, expected } = await open(code));
  setMode('drop-post');
  await p.click('.submit-bar button[type=submit]');
  await p.waitForSelector('text=Result unknown');
  setMode('pass');
  await p.click('button:has-text("Change quantities")');
  const note = await p.locator('.callout.info').innerText();
  const editable = await inputs[0].evaluate((el) => !el.readOnly);
  await inputs[0].fill(String(expected[0] + 1));
  const label = (await p.locator('.submit-bar button[type=submit]').innerText()).toLowerCase();
  await p.click('.submit-bar button[type=submit]');
  await p.waitForSelector('text=Already counted', { timeout: 20000 });
  const kept = await (await fetch(`${API}/audit-tasks`)).json();
  const task = kept.find((t) => t.bin.code === code);
  const shownCounted = await p.locator('.table tbody tr').first().innerText();
  ok(editable && note.includes('Changed quantities are a new count') && label.includes('submit count') && task.count.result === 'PASS' && shownCounted.includes(String(expected[0])), 'D. after an unknown result, "Change quantities" is a new count: rejected, the saved one kept and shown', `label "${label}"; saved ${task.count.result}; first row "${shownCounted.replace(/\s+/g, ' ')}"`);

  console.log('page errors:', errors.length ? errors : 'none');
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

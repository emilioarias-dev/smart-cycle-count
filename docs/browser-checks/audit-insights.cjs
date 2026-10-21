// Audit insights block (D-019) in a real browser: scope, selection by
// pointer, touch and keyboard, the list, empty selection, loading and error
// states, reduced motion, both themes, phone and desktop. Figures are checked
// against the API's own answer (GET /insights/audits through the proxy).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const STATE = process.env.CHECKS_STATE ?? path.join(os.tmpdir(), 'scc-browser-checks');
const SHOTS = process.env.SHOTS ?? null;
const B = 'http://localhost:3000';
const API = 'http://localhost:3001';
const setMode = (m) => fs.writeFileSync(path.join(STATE, 'mode'), m);
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d !== '' ? ' — ' + d : ''}`); };

const metricsText = async (p) => (await p.locator('.ins-metrics').innerText()).replace(/\s+/g, ' ');
const expectedMetrics = (s) => [
  s.coverage.denominator === 0 ? 'No bins' : `${s.coverage.numerator} / ${s.coverage.denominator} bin`,
  `${s.counts.pass} PASS · ${s.counts.fail} FAIL`,
  s.failProportion.denominator === 0 ? 'No counts' : `${s.failProportion.numerator} / ${s.failProportion.denominator} count`,
];

(async () => {
  setMode('pass');
  const api = await (await fetch(API + '/insights/audits')).json();
  const whole = api.scopes.find((s) => s.aisle === null);
  const aisleA = api.scopes.find((s) => s.aisle === 'A');
  // A part with bins and a part without, for the selection checks.
  const withBins = api.bins.find((b) => b.latest?.result === 'FAIL') ?? api.bins.find((b) => b.latest);
  const b = await chromium.launch();
  const errors = [];

  for (const [name, options] of [
    ['desktop', { viewport: { width: 1440, height: 900 } }],
    ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ]) {
    for (const theme of ['light', 'dark']) {
      const p = await (await b.newContext({ ...options, colorScheme: theme })).newPage();
      p.on('pageerror', (e) => errors.push(e.message));
      await p.goto(B + '/');
      await p.waitForSelector('.ins-metrics');
      const section = p.locator('section.insights');
      await section.scrollIntoViewIfNeeded();
      const text = await metricsText(p);
      ok(expectedMetrics(whole).every((t) => text.includes(t)), `${name} ${theme}: All aisles metrics = API`, text.replace(/\s+/g, ' ').slice(0, 140));
      ok((await p.locator('.ins-row').count()) === api.scopes.length - 1 && (await p.locator('.ins-table').count()) === 0 && (await p.locator('.ins-hint').isVisible()),
        `${name} ${theme}: one bar per aisle, a hint, no table before a selection`);
      // Every bar's labels sum to the aisle's bins.
      const sums = await p.locator('.ins-row').evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('.ins-part b')].reduce((n, e) => n + Number(e.textContent), 0)));
      ok(JSON.stringify(sums) === JSON.stringify(api.scopes.filter((s) => s.aisle).map((s) => s.bins)), `${name} ${theme}: the three parts of each bar sum to the aisle's bins`, JSON.stringify(sums));
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(overflow <= 0, `${name} ${theme}: no horizontal scroll`, `${overflow}px`);

      if (withBins) {
        // Pointer or touch on a segment of the bar.
        const seg = p.locator(`.ins-row:has-text("Aisle ${withBins.aisle}") .ins-seg.${withBins.latest.result.toLowerCase()}`);
        const before = await metricsText(p);
        if (name === 'phone') await seg.tap(); else await seg.click();
        await p.waitForSelector('.ins-table');
        const listed = await p.locator('.ins-table tbody tr td:first-child').allInnerTexts();
        const want = api.bins.filter((x) => x.aisle === withBins.aisle && x.latest?.result === withBins.latest.result).map((x) => x.code);
        ok(JSON.stringify(listed) === JSON.stringify(want) && (await metricsText(p)) === before, `${name} ${theme}: ${name === 'phone' ? 'tap' : 'click'} on a segment lists its bins; metrics unchanged`, listed.join(', '));
        const row = await p.locator('.ins-table tbody tr').first().innerText();
        ok(row.includes(withBins.latest.result) && row.includes('UTC') && (await p.locator('.ins-table tbody tr a').first().getAttribute('href')) === `/bins/${want[0]}`, `${name} ${theme}: list row has the link, latest result with date, counts`, row.replace(/\s+/g, ' '));
        if (SHOTS) await section.screenshot({ path: path.join(SHOTS, `insights-${name}-${theme}.png`) });
        // Clear selection returns the focus to the part's label.
        await p.click('text=Clear selection');
        const focus = await p.evaluate(() => document.activeElement?.className ?? '');
        ok((await p.locator('.ins-table').count()) === 0 && focus.includes('ins-part'), `${name} ${theme}: Clear selection empties the list, focus back on the label`, focus);
      }
      await p.close();
    }
  }

  // Keyboard only (desktop): scope by arrow keys, a part by Tab + Enter.
  const k = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await k.goto(B + '/');
  await k.waitForSelector('.ins-metrics');
  await k.locator('.ins-scope input').first().focus();
  await k.keyboard.press('ArrowRight');
  await k.waitForTimeout(250);
  const aText = await metricsText(k);
  ok(expectedMetrics(aisleA).every((t) => aText.includes(t)) && (await k.locator('.ins-row').count()) === 1, 'keyboard: arrow key picks Aisle A; its metrics and only its bar', aText.replace(/\s+/g, ' ').slice(0, 120));
  // A part of aisle A with no bin: an empty selection, said so.
  const emptyPart = ['pass', 'fail', 'none'].find((p) => aisleA.latestResults[p] === 0);
  const fullPart = ['none', 'pass', 'fail'].find((p) => aisleA.latestResults[p] > 0);
  await k.locator(`.ins-part.${fullPart}`).focus();
  await k.keyboard.press('Enter');
  await k.waitForSelector('.ins-table');
  const n = await k.locator('.ins-table tbody tr').count();
  const status = await k.locator('.ins-list [role=status]').innerText();
  ok(n === aisleA.latestResults[fullPart] && (await k.locator(`.ins-part.${fullPart}`).getAttribute('aria-pressed')) === 'true' && status.includes(`${n} bin`),
    `keyboard: Enter on "${fullPart}" lists ${n} bins, pressed state and a status message`, status);
  const stillA = await metricsText(k);
  ok(stillA === aText, 'keyboard: the selection does not change the metrics');
  if (emptyPart) {
    await k.locator(`.ins-part.${emptyPart}`).focus();
    await k.keyboard.press('Enter');
    await k.waitForSelector('.ins-empty');
    ok((await k.locator('.ins-table').count()) === 0, `empty selection ("${emptyPart}" in aisle A): a message, no table`, await k.locator('.ins-empty').innerText());
  }
  // A new scope clears the selection.
  await k.locator('.ins-scope input').nth(2).focus();
  await k.keyboard.press('Space');
  await k.waitForTimeout(250);
  ok((await k.locator('.ins-list-head').count()) === 0 && (await k.locator('.ins-hint').count()) === 1, 'changing the aisle clears the selection');
  // Focus ring visible on a part label.
  await k.locator('.ins-part').first().focus();
  await k.keyboard.press('Shift+Tab');
  await k.keyboard.press('Tab');
  const outline = await k.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  ok(outline !== 'none', 'visible focus on the part labels', outline);
  // Accessible names.
  const names = await k.locator('.ins-part').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  ok(names.every((x) => /bins?$/.test(x)), 'part labels have names with their figures', names.join(' | '));

  // Reduced motion: no fade on scope change.
  const rm = await (await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })).newPage();
  await rm.goto(B + '/');
  await rm.waitForSelector('.ins-metrics');
  const anim = await rm.locator('.ins-fade').first().evaluate((e) => getComputedStyle(e).animationName);
  ok(anim === 'none', 'reduced motion: no fade', anim);

  // The floating Rivy button does not cover the block's controls at the end of the page.
  const end = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await end.goto(B + '/');
  await end.waitForSelector('.ins-metrics');
  await end.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await end.waitForTimeout(300);
  const covered = await end.evaluate(() =>
    [...document.querySelectorAll('section.insights button:not([tabindex="-1"]), section.insights input, section.insights a')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })
      .filter((e) => { const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit && !e.contains(hit) && !hit.contains(e) && e.closest('label') !== hit.closest('label'); })
      .map((e) => e.textContent.trim() || e.outerHTML.slice(0, 40)));
  ok(covered.length === 0, 'phone, end of the page: no insights control under the Rivy button or tab bar', covered.join(', '));

  // Loading and error states.
  setMode('slow-insights');
  const l = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await l.goto(B + '/', { waitUntil: 'commit' });
  await l.waitForSelector('.ins-loading', { timeout: 10000 });
  const loadingShown = await l.locator('.ins-loading').innerText();
  const heatmapFirst = await l.locator('#heatmap-title').count();
  await l.waitForSelector('.ins-metrics', { timeout: 10000 });
  ok(loadingShown.includes('Loading') && heatmapFirst === 1, 'slow answer: the rest of Warehouse shows, the block says it is loading, then fills in');
  setMode('502-insights');
  await l.goto(B + '/');
  await l.waitForSelector('section.insights .callout.error');
  const err = await l.locator('section.insights .callout.error').innerText();
  ok(/Could not load the audit insights/.test(err) && (await l.locator('#heatmap-title').count()) === 1, 'error: a message in the block, the rest of Warehouse unaffected', err.replace(/\s+/g, ' ').slice(0, 100));
  setMode('pass');

  ok(errors.length === 0, 'no page errors', errors.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { setMode('pass'); console.error(e); process.exit(2); });

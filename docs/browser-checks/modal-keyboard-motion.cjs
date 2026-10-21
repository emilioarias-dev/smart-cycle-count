// Modal keyboard, inert background, reduced motion on ::after, and the
// waiting announcement (audit, point 5). Gemini SIMULATED (slow3 = 3 s).
// The modal panel is checked on a tablet (800 px); on phones (step 5) Rivy's
// tab in the tab bar opens it instead of a floating button.
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
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d !== '' ? ' — ' + d : ''}`); };

(async () => {
  setGemini('ok');
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 800, height: 1024 }, isMobile: true, hasTouch: true })).newPage();
  await p.goto(B + '/tasks');
  await p.waitForLoadState('networkidle');

  // 1. Shift+Tab right after opening (focus on the title).
  await p.locator('.rivy-button').focus();
  await p.keyboard.press('Enter');
  await p.waitForSelector('.rivy-panel.modal');
  const start = await p.evaluate(() => document.activeElement.id);
  await p.keyboard.press('Shift+Tab');
  const back = await p.evaluate(() => !!document.activeElement.closest('.rivy-panel'));
  ok(start === 'rivy-panel-title' && back, 'modal: Shift+Tab from the title stays inside', `start ${start}, inside ${back}`);
  await p.keyboard.press('Tab');
  ok(await p.evaluate(() => !!document.activeElement.closest('.rivy-panel')), 'modal: Tab stays inside');

  // 2. The page behind is inert while the panel is modal.
  const inert = await p.evaluate(() => ['.topbar', 'main', '.tabbar'].map((s) => !!document.querySelector(s)?.closest('[inert]')));
  ok(inert.every(Boolean), 'modal: top bar, page and tab bar are inert', JSON.stringify(inert));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  const after = await p.evaluate(() => ({ inert: !!document.querySelector('[inert]'), focus: document.activeElement.classList.contains('rivy-button') }));
  ok(!after.inert && after.focus, 'Esc: closes, nothing left inert, focus back on the button', JSON.stringify(after));

  // 3. The waiting text is announced once, not every second.
  setGemini('slow3');
  await p.locator('.rivy-button').click();
  await p.waitForSelector('.rivy-panel.modal');
  await p.fill('#rivy-question', 'How is the risk score calculated?');
  await p.press('#rivy-question', 'Enter');
  await p.waitForSelector('.rivy-waiting');
  // What a screen reader gets from the live regions: text without aria-hidden parts.
  const live = () =>
    p.evaluate(() =>
      [...document.querySelectorAll('.rivy-panel [role=status], .rivy-panel [aria-live]')]
        .map((e) => {
          const copy = e.cloneNode(true);
          copy.querySelectorAll('[aria-hidden="true"]').forEach((h) => h.remove());
          return copy.textContent;
        })
        .join('|'),
    );
  await p.waitForTimeout(1200);
  const first = await live();
  await p.waitForTimeout(1100);
  const second = await live();
  const seconds = await p.locator('.rivy-waiting').innerText();
  ok(first === second && /\d+ s/.test(seconds), 'waiting: the seconds still show, but the announced text does not change each second', `"${first.slice(0, 60)}" → "${second.slice(0, 60)}"`);
  await p.waitForSelector('.rivy-panel .rivy-text', { timeout: 15000 });
  setGemini('ok');

  // 4. Reduced motion also stops ::after (the busy ring).
  const rm = await (await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
  await rm.goto(B + '/');
  setGemini('slow3');
  await rm.click('.rivy-button');
  await rm.fill('#rivy-question', 'How is the risk score calculated?');
  await rm.press('#rivy-question', 'Enter');
  await rm.keyboard.press('Escape');
  await rm.waitForSelector('.rivy-button.busy');
  const ring = await rm.evaluate(() => getComputedStyle(document.querySelector('.rivy-button.busy'), '::after').animationName);
  ok(ring === 'none', 'reduced motion: the busy ring (::after) does not spin', ring);
  await rm.waitForSelector('.rivy-button-dot', { timeout: 15000 });
  setGemini('ok');

  // 5. Phone: no floating button over the page; Rivy's tab (with the
  // avatar) opens the same panel on the same page, shows that Rivy is
  // answering and then a new answer, and gets the focus back on close.
  const ph = await (await b.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })).newPage();
  await ph.goto(B + '/tasks');
  await ph.waitForLoadState('networkidle');
  const tab = ph.locator('.tabbar [data-rivy-launcher]');
  ok((await ph.locator('.rivy-button').isVisible().catch(() => false)) === false && (await tab.locator('.rivy-avatar').count()) === 1, 'phone: no floating button; the Rivy tab has the avatar');
  setGemini('slow3');
  await tab.tap();
  await ph.waitForSelector('.rivy-panel.modal');
  const samePage = ph.url().endsWith('/tasks');
  await ph.fill('#rivy-question', 'How is the risk score calculated?');
  await ph.press('#rivy-question', 'Enter');
  await ph.keyboard.press('Escape');
  await ph.waitForTimeout(200);
  const tabFocused = await ph.evaluate(() => document.activeElement?.hasAttribute('data-rivy-launcher'));
  const busy = await tab.locator('.tab-avatar.busy').count();
  const busyName = await tab.getAttribute('aria-label');
  ok(samePage && tabFocused && busy === 1 && busyName.endsWith(', answering'), 'phone: the tab opens the panel on the same page; Esc returns the focus to it; ring while answering', `${ph.url()} · ${busyName}`);
  await ph.waitForSelector('.tabbar [data-rivy-launcher] .tab-dot', { timeout: 15000 });
  const newName = await tab.getAttribute('aria-label');
  await tab.tap();
  await ph.waitForSelector('.rivy-panel.modal .rivy-text', { timeout: 5000 });
  const answerShown = await ph.locator('.rivy-panel.modal .rivy-text').count();
  await ph.locator('.rivy-panel.modal button[aria-label^="Close"]').tap();
  await ph.waitForTimeout(200);
  const backAfterClose = await ph.evaluate(() => document.activeElement?.hasAttribute('data-rivy-launcher'));
  const cleared = await tab.locator('.tab-dot').count();
  ok(newName.endsWith(', new answer') && answerShown > 0 && backAfterClose && cleared === 0, 'phone: a new answer shows a dot; the tab opens the same conversation; ✕ returns the focus; dot cleared', `${newName}`);
  setGemini('ok');

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

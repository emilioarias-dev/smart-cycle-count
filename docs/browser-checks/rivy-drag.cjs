// Dragging Rivy's floating button (D-018) in a real browser: on a phone with
// real touch events (Chromium's DevTools protocol), and on a desktop with
// the mouse and the keyboard. A tap or a click opens the panel; a drag only
// moves the button, kept on screen and above the bars; the position is kept
// while navigating and after a rotation, and reset from the panel; the
// button stays hidden during a count.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const B = 'http://localhost:3000';
const API = 'http://localhost:3001';
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d !== '' ? ' — ' + d : ''}`); };
const round = (r) => r && { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };

(async () => {
  const b = await chromium.launch();
  const errors = [];

  // ---- Phone, touch ----
  const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  // A finger press at (x, y), moved by (dx, dy) in steps, then lifted.
  async function finger(x, y, dx, dy, steps = 8) {
    await touch('touchStart', x, y);
    for (let i = 1; i <= steps; i++) await touch('touchMove', x + (dx * i) / steps, y + (dy * i) / steps);
    await touch('touchEnd');
    await p.waitForTimeout(250);
  }
  const box = () => p.locator('.rivy-button').evaluate((e) => e.getBoundingClientRect().toJSON()).then(round);
  const centre = async () => { const r = await box(); return [(r.left + r.right) / 2, (r.top + r.bottom) / 2]; };
  const panelOpen = () => p.locator('.rivy-panel').count();
  const closePanel = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(250); };
  const area = () => p.evaluate(() => ({
    top: document.querySelector('.topbar').getBoundingClientRect().bottom,
    // The tab bar's top, or the bottom of the screen where it is not shown.
    tabbar: document.querySelector('.tabbar').getClientRects().length > 0 ? document.querySelector('.tabbar').getBoundingClientRect().top : window.innerHeight,
    width: document.documentElement.clientWidth,
    scrollY: window.scrollY,
  }));

  await p.goto(B + '/');
  await p.waitForSelector('.rivy-button');
  const home = await box();

  let [x, y] = await centre();
  await finger(x, y, 0, 0, 1);
  ok((await panelOpen()) === 1, 'phone: a tap opens the panel');
  await closePanel();
  ok(await p.evaluate(() => document.activeElement?.classList.contains('rivy-button')), 'phone: closing returns the focus to the button');

  await finger(x, y, 5, 4, 3);
  ok((await panelOpen()) === 1, 'phone: a tap with a small shake (6 px) still opens it');
  await closePanel();

  const before = await area();
  await finger(x, y, -150, -300);
  const moved = await box();
  const after = await area();
  ok((await panelOpen()) === 0 && Math.abs(moved.left - (home.left - 150)) <= 2 && Math.abs(moved.top - (home.top - 300)) <= 2 && after.scrollY === before.scrollY,
    'phone: a drag moves the button, does not open the panel, does not scroll the page', JSON.stringify(moved));

  [x, y] = await centre();
  await finger(x, y, 0, 900);
  let r = await box();
  let a = await area();
  ok((await panelOpen()) === 0 && r.bottom <= a.tabbar - 8 + 1, 'phone: dragged down, it stops above the tab bar', `bottom ${r.bottom}, tab bar ${Math.round(a.tabbar)}`);
  [x, y] = await centre();
  await finger(x, y, -900, -2000);
  r = await box();
  a = await area();
  ok(r.left >= 8 - 1 && r.top >= a.top + 8 - 1, 'phone: dragged to the top left, it stays on screen and under the top bar', JSON.stringify(r));

  // Kept while navigating.
  await finger(...(await centre()), 120, 200);
  // The offset, not the box: a touched button keeps :hover (a 2 px lift).
  const offsetNow = () => p.locator('.rivy-button').evaluate((e) => e.style.translate);
  const kept = await offsetNow();
  await p.locator('.tabbar a[href="/tasks"]').tap();
  await p.waitForURL('**/tasks');
  await p.waitForTimeout(300);
  const there = await offsetNow();
  ok(kept !== "" && there === kept, 'phone: the position is kept after navigating', `${JSON.stringify(kept)} → ${JSON.stringify(there)}`);

  // Rotation: landscape, then back.
  await p.setViewportSize({ width: 812, height: 375 });
  await p.waitForTimeout(400);
  r = await box();
  a = await area();
  ok(r.left >= 7 && r.right <= a.width - 7 && r.top >= a.top + 7 && r.bottom <= a.tabbar - 7, 'phone rotated to landscape: the button is brought back inside', JSON.stringify(r));
  await p.setViewportSize({ width: 375, height: 812 });
  await p.waitForTimeout(400);
  r = await box();
  a = await area();
  ok(r.left >= 7 && r.right <= a.width - 7 && r.bottom <= a.tabbar - 7, 'phone back to portrait: still inside', JSON.stringify(r));

  // Reset from the panel.
  await finger(...(await centre()), 0, 0, 1);
  const reset = p.getByRole('button', { name: "Put Rivy's button back in its corner" });
  const offered = await reset.count();
  await reset.tap();
  await closePanel();
  await p.goto(B + '/tasks');
  await p.waitForSelector('.rivy-button');
  ok(offered === 1 && JSON.stringify(await box()) === JSON.stringify(home) && (await p.getByRole('button', { name: "Put Rivy's button back in its corner" }).count()) === 0,
    'phone: "Put the button back" in the panel returns it to its corner', JSON.stringify(home));

  // Hidden while counting (it would sit over the count's controls).
  const tasks = await (await fetch(API + '/audit-tasks')).json();
  let pending = tasks.find((t) => t.status === 'PENDING');
  if (!pending) {
    await fetch(API + '/audit-plans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"n":1}' });
    pending = (await (await fetch(API + '/audit-tasks')).json()).find((t) => t.status === 'PENDING');
  }
  await p.goto(`${B}/count?bin=${pending.bin.code}`);
  await p.waitForSelector('.submit-bar');
  await p.waitForTimeout(300);
  ok((await p.locator('.rivy-button').count()) === 0, 'phone: hidden while a count is open');
  await ctx.close();

  // ---- Desktop, mouse and keyboard ----
  const d = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  d.on('pageerror', (e) => errors.push(e.message));
  await d.goto(B + '/');
  await d.waitForSelector('.rivy-button');
  const dbox = () => d.locator('.rivy-button').evaluate((e) => e.getBoundingClientRect().toJSON()).then(round);
  const dhome = await dbox();
  const cx = (dhome.left + dhome.right) / 2;
  const cy = (dhome.top + dhome.bottom) / 2;
  await d.mouse.move(cx, cy);
  await d.mouse.down();
  await d.mouse.move(cx - 300, cy - 200, { steps: 10 });
  await d.mouse.up();
  await d.waitForTimeout(250);
  const dmoved = await dbox();
  ok((await d.locator('.rivy-panel').count()) === 0 && Math.abs(dmoved.left - (dhome.left - 300)) <= 2, 'desktop: a mouse drag moves the button without opening the panel', JSON.stringify(dmoved));
  await d.mouse.move(cx - 300, cy - 200);
  await d.mouse.down();
  await d.mouse.move(cx - 298, cy - 199);
  await d.mouse.up();
  await d.waitForTimeout(300);
  ok((await d.locator('.rivy-panel.docked').count()) === 1, 'desktop: a click (2 px of movement) opens the docked panel');
  await d.keyboard.press('Escape');
  await d.waitForTimeout(250);
  await d.locator('.rivy-button').focus();
  await d.keyboard.press('Enter');
  await d.waitForSelector('.rivy-panel.docked');
  ok(true, 'desktop: the keyboard opens it (Enter on the button), no dragging needed');
  await d.keyboard.press('Escape');
  await d.waitForTimeout(250);
  const tipBox = await d.locator('.rivy-button-tip').evaluate((e) => e.getBoundingClientRect().toJSON()).then(round);
  ok(tipBox.left >= 0 && tipBox.bottom <= dmoved.top + 1, 'desktop: a moved button shows its tip above it, on screen', JSON.stringify(tipBox));

  ok(errors.length === 0, 'no page errors', errors.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

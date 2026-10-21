# Browser regression checks

Scripts kept from the verifications of 2026-10-21 (see `VERIFICATION.md`):
real browser checks of cases that the unit and API tests cannot reach.
They are **not needed to run the app or `npm test`**, are **not part of
`npm test`** and add no dependency to the project. They were written for
and run only on Linux with Chromium:
they need [Playwright](https://playwright.dev) with Chromium installed on
the machine, and a bash shell (the plan check stops and restarts the proxy
with `fuser` and `nohup`). They were run on Linux.

| Script | What it checks |
|---|---|
| `ambiguous-plans.cjs` | Create plan when the plan is saved but the answer is a 502 or a cut-off body, and when the Server Action's own answer is lost: "Plan not confirmed", a link to Tasks, no Retry; Retry pressed three times while pending sends one request |
| `count-retry.cjs` | A count whose result is unknown: "Send the same count again" resends exactly what was sent (also after a quantity was changed); the fields cannot change while sending; "Change quantities" is a new count, rejected without overwriting the saved one |
| `modal-keyboard-motion.cjs` | Rivy's modal panel (tablet, 800 px): Shift+Tab from the title stays inside, the page behind is inert, Esc returns the focus; the waiting seconds are not announced; reduced motion stops the busy ring (`::after`). Phone (375 px): the floating button opens the sheet on the same page and gets the focus back on Esc |
| `audit-insights.cjs` | The Audit insights block (D-019) against the API's own answer: metrics per scope, bars summing to each aisle's bins, a segment click or tap and a label by keyboard listing the right bins without changing the metrics, Clear selection and focus, an empty selection, a new aisle clearing the selection, reduced motion, nothing under Rivy's button, and the loading and error states (proxy modes `slow-insights` and `502-insights`); desktop and phone, light and dark |
| `rivy-drag.cjs` | Dragging Rivy's button: on a phone with real touch events, a tap (also with a 6 px shake) opens the panel and a drag only moves it without scrolling the page; it stops above the tab bar and under the top bar; position kept after navigating; brought back inside after a rotation; **Put the button back** in the panel; hidden during a count. Desktop: a mouse drag moves it, a click opens the panel, Enter opens it from the keyboard; the tip of a moved button is shown above it |
| `rivy-does-not-block.cjs` | With a slow Gemini, Create plan reaches the API and shows its result while Rivy waits; after a Gemini timeout the app keeps working |

Helpers: `proxy.cjs` (port 3001, in front of the API on 3002: it can delay,
cut or drop answers, delay or fail `/insights` only, and logs every request) and `mock-gemini.cjs` (a
simulated Gemini on 127.0.0.1:4010; it is not the real model). Their modes
are files in `$CHECKS_STATE` (default: `<tmp>/scc-browser-checks`).

## Running them

1. Build: `npm run build`. Load the original demo and make a plan with at
   least four pending tasks (`count-retry.cjs` needs them; the plan check
   creates plans of one bin):

   ```bash
   SEED_NOW=2026-10-18T12:00:00Z npm run db:reset-demo   # deletes plans and counts
   ```

   then **Create plan** with Top N 5 in the app (or `POST /audit-plans`).

2. Start the simulated Gemini, the API on port 3002 and the proxy on 3001,
   then the web app (its `API_BASE_URL` is `http://localhost:3001`):

   ```bash
   node docs/browser-checks/mock-gemini.cjs &
   PORT=3002 GEMINI_API_BASE=http://127.0.0.1:4010/v1beta GEMINI_API_KEY=simulated GEMINI_RPM=1000 npm run start -w apps/api &
   node docs/browser-checks/proxy.cjs &
   npm run start -w apps/web &
   ```

3. Run each script with Node, for example
   `PLAYWRIGHT_MODULE=/path/to/playwright node docs/browser-checks/count-retry.cjs`
   (`PLAYWRIGHT_MODULE` is only needed if `playwright` cannot be found by
   `require`). Each prints one PASS / FAIL line per check and exits with 1
   on a failure.

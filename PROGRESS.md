# Progress

What is implemented in the repository. Decisions are in `DECISIONS.md`;
evidence that something works is in `VERIFICATION.md`.

## Milestone 1 — walking skeleton

**Scope (agreed):** one bin persisted in PostgreSQL, read through Prisma and
NestJS, and shown in Next.js. No layout, movements, scoring, heatmap, plans or
counts. Deferred decisions stay open.

**Acceptance criteria (confirmed by the author on 2026-10-18):** those
proposed in `HANDOFF.md` §12, with these adjustments:

- PostgreSQL runs through Docker Compose in both environments.
- `Bin` model with only `id` and a unique `code`; one sample bin,
  `SAMPLE-BIN-01`. The real code format is still deferred.
- `GET /bins/:code` returns the bin, or `404` when the code does not exist.
- The API test runs against a separate test database in the same PostgreSQL
  container.
- Ports: API `3001`, web `3000`. PostgreSQL container on host port `5433`
  (added 2026-10-18 after the first Windows run: the author's PC runs a
  native PostgreSQL on 5432).

**Status:** implemented on branch `m1-walking-skeleton` and verified in both
environments, Claude Code (Linux) and the author's Windows PC, on code commit
`a501c55` (later commits only change documentation). Merged into `main` as
`9622bb6` after all checks passed, including bin persistence across
`db:down` / `db:up` on Windows.

| # | Criterion | Implementation | Verified in CC | Verified on WIN |
|---|---|---|---|---|
| 1 | Structure | Root workspace, one lockfile, `.nvmrc`/`.node-version`, `.npmrc`, `.gitattributes`, `.gitignore`, `.env.example` per app, `docker-compose.yml`, docs | Yes | Yes |
| 2 | Reproducible install | `npm ci` from the committed lockfile; Node/npm enforced by `engines` + `engine-strict` | Yes (Node 22 rejected, Node 24.22.0 OK) | Yes (`npm ci`; 32-bit `sharp` skipped) |
| 3 | Database | Compose service with the pinned image on host port 5433; migration `create_bins` | Yes (from an empty volume; port change with data preserved) | Yes on `a501c55` (healthy on 5433, 16.15, migrations up to date); the first application of the migration was not shown |
| 4 | Data | `npm run db:seed` upserts `SAMPLE-BIN-01`; data kept in a Docker volume | Yes (twice → one row; same row after `db:down` / `db:up` without seed) | Seed: yes (after delete and while `dev` ran → one row; idempotency covered by the tests). Persistence after `db:down` / `db:up`: yes (same row, volume kept) |
| 5 | API | `GET /bins/:code` through `BinsService` → `PrismaService` (adapter-pg); Vitest suite against the test database | Yes (4/4 tests, manual 200/404) | Yes (4/4 tests, manual 200/404) |
| 6 | Web | Server component fetches the bin; bin, not-found and error states | Yes (all three states) | Yes (three states, reported by the author; API reachability and errors in the logs) |
| 7 | Dev workflow | `npm run dev` starts both apps; Ctrl+C stops both | Yes (Linux) | Yes (Ctrl+C asks `S/N` per process; ports freed) |
| 8 | Builds | `npm run build` type-checks and builds both apps | Yes | Yes (first attempt, `1874d44`; code unchanged since except the port) |
| 9 | Repository | Small commits, no secrets or generated files; push demonstrated | Yes | — |
| 10 | Evidence | `VERIFICATION.md`, per environment | CC recorded | Recorded |

### Where things are

| Path | Role |
|---|---|
| `apps/api/prisma/schema.prisma` | `Bin` model (`id`, unique `code`) mapped to the `bins` table |
| `apps/api/prisma/migrations/` | Committed SQL migrations |
| `apps/api/prisma.config.ts` | Prisma 7 configuration; loads `apps/api/.env` |
| `apps/api/src/prisma/prisma.service.ts` | The only database connection (Prisma client + `pg` driver adapter) |
| `apps/api/src/bins/` | `GET /bins/:code`: controller (HTTP, 404) and service (query) |
| `apps/api/src/sample-data.ts`, `src/seed.ts` | Idempotent sample data and the seed command |
| `apps/api/test/` | API tests against the PostgreSQL test database |
| `apps/web/lib/api.ts` | Server-side API client; turns responses into bin / not-found / error |
| `apps/web/app/page.tsx` | The page that shows the sample bin |

### Known limitations of this milestone

- The page answers HTTP `200` even when it shows the not-found or error
  state; the state is communicated in the page content.
- `npm run db:seed` compiles the seed separately (`dist-seed/`) so that it
  can run while `npm run dev` is running.
- Developer setup needs Docker; there is no native PostgreSQL path.

## Milestone 2 — warehouse data

**Scope (agreed 2026-10-18):** warehouse data (D-006, D-007), the movement
function (D-008), reproducible demo data with an explicit reset (D-009),
read endpoints and a neutral grid with a mobile-friendly bin detail. Out of
scope: scoring and risk colors, audit plans, counts, creating movements
through the API, D-001 concurrency tests (count milestone).

**Status:** implemented on branch `m2-warehouse-data` and **verified in both
environments**, Claude Code (Linux) and the author's Windows PC, on code
commit `a1461d6` (later commits only change documentation). A first Windows
run failed on a test hook limit and was corrected. Ready to merge (E-009).

| # | Criterion | Implementation | Verified in CC | Verified on WIN |
|---|---|---|---|---|
| 1 | Migration from milestone 1 and from an empty database; constraints | Migration `warehouse_inventory` in its own transaction: removes only `SAMPLE-BIN-01`, refuses other existing bins; CHECKs, unique keys and non-cascading relations | Yes (M1 database, empty database, refusal with an extra bin; constraint tests) | Yes (milestone 1 → 2 on the test database; empty database `smart_cycle_count_empty`) |
| 2 | Reproducible seed, time coverage, no future events | `generateDemoData` (seeded, `SEED_NOW` with explicit zone, UTC) | Yes (same data twice, compared by SQL and by tests; no event after the reference) | Yes (reset output and data fingerprints identical to Linux; generator tests) |
| 3 | Four movements, rejections, rollback | `applyMovement` | Yes (12 tests, incl. rollback of quantities, location, log and versions) | Yes (12 tests) |
| 4 | Independent rebuild; versions = movements per bin | Test replays the log without `applyMovement` | Yes | Yes |
| 5 | Unauthorised reset refused; rollback on failure | `resetDemoData` + `npm run db:reset-demo` | Yes (no flag, non-dedicated database, invalid `SEED_NOW`, failing rebuild) | Yes (refusal without the flag; reset tests incl. rollback) |
| 6 | API: warehouse and bin detail, 404 | `GET /warehouse`, `GET /bins/:code` (normalised) | Yes (6 tests + manual) | Yes (6 tests; pages served through the API in `npm run dev`) |
| 7 | Grid, detail, error/not-found states, mobile width | Pages `/` and `/bins/[code]` | Yes (all states; 375 px viewport without horizontal overflow) | Yes: grid and detail (author's visual confirmation), phone width (overflow 0 at 375 px), error state (visual + log), not-found state (directed check: API 404, page shows "Bin not found") |
| 8 | Builds, tests, documented start; Windows reproduction | README | Yes (39/39 tests, builds, `npm run dev`, reset while `dev` runs) | Yes on `86da0ef` (39/39, builds; apps start, reset while `dev` runs, Ctrl+C stops both); first run on `dc312aa` **failed** (hook timeout), corrected in `a1461d6` |

### Where things are

| Path | Role |
|---|---|
| `apps/api/prisma/migrations/20261018120000_warehouse_inventory/` | Milestone 2 schema, data guard and CHECK constraints |
| `apps/api/src/inventory/movements.ts` | `applyMovement`: the only way inventory changes |
| `apps/api/src/inventory/bin-code.ts` | Bin code format and normalisation |
| `apps/api/src/demo-data/` | Seeded generator, catalog, reference time and the transactional reset |
| `apps/api/src/reset-demo.ts` | The `db:reset-demo` command |
| `apps/api/src/warehouse/`, `src/bins/` | `GET /warehouse`, `GET /bins/:code` |
| `apps/api/test/` | Movement, constraint, generator, reset and API tests |
| `apps/web/app/page.tsx`, `app/bins/[code]/page.tsx` | Grid and bin detail |

### Implementation notes

- **Prisma does not run a migration in a transaction** (verified with a
  failing test migration). The milestone 2 migration therefore wraps itself
  in `BEGIN … COMMIT`, so a failure applies nothing.
- **Generator parameters** were tuned once before fixing version 1: the
  first attempt left 22 of 30 bins full, a second one left 14 empty. Version
  1 ends with 83 located pallets, 2 empty bins and varied occupancy. Any
  later change to the generator needs a new version and new test fixtures.
- **Locking order:** bins in id order, then the pallet; the state is
  validated after the locks. A pallet that changes bin between the first
  read and the lock is rejected (`CONCURRENT_CHANGE`); the D-001
  concurrency tests come with the count milestone.

### Known limitations

- No bin capacity rule (the demo data keeps at most 4 pallets per bin).
- `lastAuditedAt` is simulated; there are no audit records or results yet.
- The demo reset replaces all inventory data; its behaviour once plans and
  counts exist is still to be decided (D-009).
- The pages answer HTTP `200` also in their not-found and error states.
- `npm run dev` starts the web before the API finishes compiling; a page
  loaded in those first seconds shows the error state until reloaded
  (observed on Windows).

## Milestone 3 — risk scoring

**Scope (agreed 2026-10-18, D-010):** one backend implementation of the
score, the stored breakdown, an all-or-nothing recompute (after the demo
reset with its reference; from a button with the current time), a grid
colored by priority with number and label, and the "why" on the bin detail.
Out of scope: PASS/FAIL history (count milestone), optional improvements.

**Status:** verified in both environments (code `b1a0cc5`; later commits only
change documentation) and merged into `main` as `2933e00`.

| Check | Implementation | Verified in CC | Verified on WIN |
|---|---|---|---|
| Formula: weights, caps, never audited = maximum, rounding once (half up), bands | `src/scoring/formula.ts` (pure) | Yes (9 unit tests) | Yes (9 tests) |
| Window `(reference − 30 d, reference]`, once per affected bin | One SQL query in `src/scoring/recompute.ts` | Yes (start excluded, +1 ms included, end included, after end excluded, move counted for both bins, adjustment once) | Yes (tests) |
| All or nothing; consistent inputs | One repeatable-read transaction; reset scores inside its own transaction | Yes (a failure while saving keeps the previous scores) | Yes (tests) |
| Demo: scores with the reset reference | `resetDemoData` | Yes (all 30 equal to the formula written in SQL; 91 / 44 / 18; caps 11 / 0 / 2; 5 / 13 / 12 by band) | Yes (reset 5 / 13 / 12; score fingerprint identical to Linux) |
| API | `GET /warehouse`, `GET /bins/:code` with `score`; `POST /scores/recompute` | Yes (tests + manual) | Yes (tests) |
| Web | Colored grid, legend, "Scores as of", recompute button; score card with "Why this score" | Yes (button recomputes 30 bins for the current time; 375 px without overflow) | Yes (author's report after the fix in `b1a0cc5`: grid, detail at 375 px, recompute button) |
| Migration from milestone 2 and from empty | `bin_scores` (CHECK 0–100, no cascade) | Yes (M2 database: 30 bins, 0 scores until recompute; empty test database: 3 migrations) | Yes (milestone 2 → 3 on the development and test databases) |
| Tests and builds | — | Yes (54/54; builds) | Yes (54/54; builds) |

### Implementation notes

- The formula is the only implementation of the score; the API returns the
  band and label, so the web does not re-implement them.
- Contributions are computed as `weight × min(input, cap) ÷ cap`, so
  integer inputs give exact values (for example 3.5 rounds to 4, not to 3
  because of a floating-point error).
- Mutation checks: including the window start, rounding each contribution
  and saving outside the transaction each make tests fail.

### Known limitations

- After migrating from milestone 2, bins show "Not scored" until the first
  recompute or demo reset.
- "Days ago" on the bin page counts from the current time, while the score
  uses its reference time (shown as "As of …").
- Weights and caps are initial heuristics; there are no count results yet
  to calibrate them.

### Fixes

- `b1a0cc5`: the score breakdown table overflowed its card at 375 px (and the
  page at 320 px); it now has three columns and fits from 320 px up.

## Milestone 4 — audit plans

**Scope (agreed 2026-10-19, D-011):** "Create plan → Top N" with the
selection, order and exclusions of D-011; tasks that keep a full copy of the
score that selected them; plan creations that take turns; a tasks page; the
demo reset deleting plans and tasks explicitly. Out of scope: closing tasks
(only through counts, milestone 5), the reset policy once counts exist,
optional improvements.

**Status:** verified in both environments (code `75c46be`; later commits
only change documentation; Windows ran `2829caf`) and merged into `main` as
`0f6d2be`.

| Check | Implementation | Verified in CC | Verified on WIN |
|---|---|---|---|
| N from 1 to 30, default 5; other values and types rejected | `parsePlanSize` in `src/planning/selection.ts`; CHECK constraints | Yes (unit tests; API `400` for 0, 31, −3, 2.5, `"5"`, `null`, `true`, `[5]`; the browser blocks 0 and the API message is shown when its validation is bypassed) | Yes (tests) |
| Eligible: scored (0 included) and without a pending task; partial plans; two distinct "no plan" answers | `selectForPlan` | Yes (unit and database tests; demo: 30 requested → 25 created, 5 skipped with a pending task; `409` `NO_AVAILABLE_BINS` and `NO_SCORES`) | Yes (tests; author's visual check at 375 px: N = 30 → 25 tasks, then N = 5 → no bins available, backed by the dev log) |
| Order: score, then never audited / oldest audit from the stored breakdown, then code | `comparePriority` | Yes (tie at the N boundary with a contradicting `lastAuditedAt`; full demo order equal to an independent SQL query; `B-01-05` before `A-02-01` at 77) | Yes (tests; default plan identical; plan fingerprint equal to Linux) |
| Tasks keep a copy of the score (value, priority, breakdown, formula version, both times, rank) | `createPlan` in `src/planning/create-plan.ts` | Yes (copies unchanged after a recompute that changed 14 of the 30 current scores) | Yes (tests) |
| Plan and tasks atomic; one `PENDING` task per bin in PostgreSQL | One transaction; partial unique index | Yes (a failing task insert leaves no plan and no task; direct inserts rejected) | Yes (tests) |
| Simultaneous requests take turns and select again | Transaction-scoped advisory lock, READ COMMITTED | Yes (8 eligible, two requests of 5 → 5 and 3, no duplicates; HTTP: two requests of 20 → 20 and 10) | Yes (tests) |
| Reset deletes plans and tasks explicitly and reports them | `resetDemoData` | Yes (`Deleted 2 audit plans and 30 tasks, with their selection explanations.`) | Yes (`Deleted 2 audit plans and 30 tasks, with their selection explanations.`; tests) |
| API | `POST /audit-plans`, `GET /audit-tasks` | Yes (tests + manual) | Yes (tests; `POST /audit-plans` `{}` → 5 of 5) |
| Web | Create plan form on the warehouse page; `/tasks` grouped by plan; navigation | Yes (320, 375, 414 and 1100 px: page, form and task tables without overflow) | Author's visual check at 375 px (form messages; Tasks with two plans, no overflow); no screenshots |
| Migration from milestone 3 and from empty | `20261019090000_audit_plans` | Yes (M3 database: bins and scores kept; empty test database: 4 migrations; no schema drift) | Yes (development and test databases: 4 migrations, none pending; the `Applying …` output itself was not captured) |
| Tests and builds | — | Yes (78/78; builds) | Yes (78/78; builds) |

### Implementation notes

- The advisory lock (key `4100011`) is released when the transaction ends.
  READ COMMITTED is deliberate: under REPEATABLE READ a request that waited
  would still see the bins as they were before the previous plan.
- `excluded.pendingTask` counts every bin with a pending task;
  `excluded.noScore` counts bins without a score and without a pending task,
  so no bin is counted twice.
- The web sends N as typed (a whole number as a number, anything else as
  text); only the API validates it.
- Mutation checks: removing the lock, using REPEATABLE READ, dropping the
  audit-date tie-break and taking the audit date from the bin instead of the
  breakdown make 1, 1, 6 and 1 tests fail respectively.

### Known limitations

- The grid does not mark bins that already have a pending task; the tasks
  page shows them.
- The demo reset deletes all plans and tasks and, with them, why each bin
  was selected. What the reset does once counts exist is still open (D-009).
- Running `npm run build` while `npm run dev` runs deletes the API's `dist/`
  and stops the development API (behaviour since milestone 1, observed again
  in this milestone); stop `dev` before building.

## Milestone 5 — count flow

**Scope (agreed 2026-10-19, D-012 with D-001, D-003, D-004; D-010 formula
v2; D-009 reset with counts):** find a bin with a pending task, count its
expected pallets, record unexpected pallets, derive PASS/FAIL, close that
task and recompute every score with the result, on a phone. Out of scope:
camera scanning, reconciling inventory after a FAIL, optional improvements.

**Status:** count flow verified in CC on code `54cf1c1`; the theme toggle
(`c892ecf`, web only) verified in CC. On Windows: terminal checks on
`00cfa69`, two screenshots, and the author's report that the web build after
the theme toggle exited 0 and that the theme and phone-width checks passed.
Merged into `main` as `690db87`. Commit `eb4cf0a` is a
checkpoint of incomplete work saved before a pause; the commits after it
complete and verify it.

| Check | Implementation | Verified in CC | Verified on WIN |
|---|---|---|---|
| Only a bin with a pending task; the count is bound to that task | `GET /bins/:code/count-sheet` (one REPEATABLE READ snapshot); `POST /audit-tasks/:taskId/count`; `counts` → (`task_id`, `bin_id`) foreign key | Yes (404 / 409 `NO_PENDING_TASK`; a later task of the same bin stays pending after a retry on the earlier one) | Yes (tests) |
| PASS/FAIL (D-003): exact quantities, 0 for missing, any unexpected pallet → FAIL; empty bin | `deriveResult`; result re-derived from the stored rows in the transaction | Yes (API tests; browser: PASS, FAIL with −1 and two unexpected pallets) | Yes (author's screenshot of `B-01-05` FAIL caused only by an unexpected pallet (P-0107 88 expected, 88 counted, variance 0); Tasks screenshot with Done · PASS and Done · FAIL; tests) |
| Unexpected pallets: code normalised, quantity ≥ 1, catalog product optional; unknown product keeps declared units; no inventory created | `parseSubmission`; `count_unexpected_pallets` CHECKs | Yes (tests; browser labels "Quantity (bag)" / "units declared, product unknown") | Yes (screenshot "UNEXPECTED-TEST-01: 12 units declared, product unknown (catalog unit not identified)"; tests) |
| Validation: types, negatives, decimals, missing / extra / repeated lines, repeated or expected codes, unknown SKU, more than 10 | `parseSubmission` and checks under the bin lock | Yes (13 cases → 400, nothing stored) | Yes (tests) |
| Identical retry → stored count "recovered", no repeated effects, also after an inventory change; other content → rejected with the stored result | Comparison of the normalised content under the bin lock | Yes (tests; browser: second tab identical → recovered, third tab different → "not saved"; HTTP in the clean clone) | Yes (tests; author's visual confirmation of "Recovered" at 375 px) |
| One count per task, also simultaneous | Scores lock + bin lock; unique `counts.task_id` | Yes (two simultaneous identical → saved + recovered; different → saved + rejected) | Yes (tests) |
| D-001: movement between open and submit; movement first; submission first | Version compared after the bin lock; changes from the movement log | Yes (the three tests; browser: conflict → draft with changes, recount starts empty, then saved) | Yes (tests) |
| One transaction: count, lines, unexpected, task DONE, audit date, every bin rescored at the count time; rollback if the recompute fails | `submitCount` | Yes (simulated recompute failure → nothing kept) | Yes (tests) |
| Formula v2: 30 / 25 / 20 / 25, last result (FAIL on, later PASS off, unknown ≠ PASS) | `formula.ts`, `recompute.ts` (one statement reads all inputs) | Yes (10 unit tests; recompute tests incl. counts after the reference; formula in SQL equal on the demo and after counts) | Yes (tests; score fingerprint after the reset identical to Linux) |
| Recomputes take turns (button, reset, counts); plans read while no count runs | `scoring/lock.ts` (advisory lock 4100012, shared for plans) | Yes (plan creation waits while the lock is held) | Yes (tests) |
| Reset deletes counts, lines and unexpected pallets, reports them; a failed reset keeps them | `resetDemoData` | Yes (tests; clean clone: `Deleted 1 counts (0 PASS, 1 FAIL) with 4 count lines and 1 unexpected pallets.`) | Yes (`Deleted 3 counts (1 PASS, 2 FAIL) with 9 count lines and 1 unexpected pallets.`; tests) |
| Web | `/count`, Tasks (Count link, Done · PASS/FAIL), bin page "Last count result" | Yes (browser flows; 320 / 375 / 414 / 1100 px without overflow; "could not confirm" when the API stops, then the same count is saved) | Yes (screenshots at desktop width; author's visual confirmation at 375 px: "Recovered", "Last count result" row) |
| Migration from milestone 4 and from empty | `20261019180000_counts` | Yes (M4 database with a plan: bins, v1 scores, plan and tasks kept; empty test database: 5 migrations; no drift) | Yes (development and test databases: 5 migrations, none pending; the `Applying …` output itself was not captured) |
| Tests and builds | — | Yes (98/98; builds) | Yes (98/98; builds) |

### Implementation notes

- Lock order in a count: the scores lock, then the bin row (the row a
  movement locks). Every count rewrites every score, so counts take turns;
  waiting for the scores lock never happens while holding a row lock.
- The recompute button now runs in READ COMMITTED after taking the scores
  lock, and reads all its inputs in one statement (consistent snapshot).
- "What changed" after a conflict comes from the movement log: each
  movement that touches a bin bumps its version once (D-008), so the
  movements after the shown version are the bin's movements past that
  position.
- Mutation checks: removing the version check, the recovered retry, the
  scores lock or the audit date update, swallowing a recompute failure, or
  taking the oldest count as the last result make 2, 2, 1, 1, 1 and 2 tests
  fail respectively.

### Presentation change: theme toggle (requested 2026-10-19)

A light / dark toggle in the top bar of every page (`components/ThemeToggle.tsx`,
CSS tokens in `globals.css`); no business rule, API or dependency changed.
Without a choice the system preference applies; the choice is stored in
`localStorage` and applied by an inline script before the first paint.
Plain links have a visited color and every focusable element a 3 px focus
outline, in both themes. The light accent went from `#1f6feb` to `#1a5fd0`:
on the page background it measured 4.32:1, below 4.5:1.

### Known limitations

- After a FAIL the inventory is not corrected (D-004): the next count of the
  bin fails again until someone adjusts it.
- With an old `SEED_NOW`, a count recomputes every score for the current
  time, which moves the activity window past the demo activity.
- Counts are serialised by the scores lock (30 bins recomputed each time):
  fine for this warehouse, not for a large one.
- Rejected and conflicting submissions are not stored (D-001), and reloading
  the count page after a count shows "no pending task".
- The consistent snapshot of the count sheet relies on REPEATABLE READ; no
  test forces a movement between its two reads.

## Milestone 6 — delivery (in preparation)

**Authorised so far (2026-10-19):** documentation and the diagnosis of the
`pg` DeprecationWarning, without changing dependencies or functional code.

- `README.md` reorganised for a first-time install: requirements, install,
  configuration, schema, demo data (with a warning, before the command, that
  it deletes plans, tasks and counts with their history), start, a
  walkthrough of the main flow, known limitations, and the database update
  notes grouped by milestone. `db:reset-demo` stays the only seed command.
- `pg` warning: cause confirmed in `readCount` (`src/counting/submit.ts`) and
  corrected (accepted 2026-10-19, `137afc9`): the count, its lines and its
  unexpected pallets are read one after another in the same transaction.
  Regression: `test/pg-queue.e2e-spec.ts` checks pg's queueing condition on
  every query while opening, saving and recovering a count; it fails with
  the previous code. `NODE_OPTIONS=--throw-deprecation npm test` passes as
  an extra check.

  Windows (2026-10-20, `350e1db`): 100/100; before the correction, on
  `main`, 98/98 with the warning from the count tests. With the correction
  the only warning left comes from the detector's self-test, which provokes
  it on purpose (VERIFICATION.md).
- Visual direction (D-013): Rivero identity approved on a static dashboard
  mockup (v3), then the refined mockups (v4: dashboard, bin details, tasks,
  count, interaction states) approved on 2026-10-20. Not in the
  application yet.

This preparation is complete: nothing pending (PR #6, merged as `e407ebc`).

### Redesign (branch `m6-redesign`, from `main`; PR #7, merged as `d8150d3`)

The approved v4 design in the app (D-013), with the choices confirmed on
2026-10-20: the pending-quantity helper in Count (a typed `0` is an answer,
an empty field is not), the "no bin in the high band" note without changing
formula or data, the Top 5 chart of all bins in the D-011 order (new
read-only `GET /scores/top`), status apart from result in Tasks, units in
the count result, fields never hidden by the fixed bars, and an accessible
icon-only recompute on phones. Onest is stored locally, so the build needs
no network. No dependency, migration, rule, formula or data change.

| Item | Where | CC verified | WIN verified |
|---|---|---|---|
| Top 5 of all bins, D-011 order, stored breakdown | `GET /scores/top`; dashboard chart | Yes (API tests incl. the 57 tie and a mutation; chart = API order before and after counts) | Yes (API tests, `578820c`) |
| Dashboard: band, heatmap markers, latest plan, chart by mouse / keyboard / touch | `app/page.tsx`, `components/` | Yes (real flows, chart checks) | Visual review only (not each flow) |
| Tasks: status apart from result | `app/tasks/page.tsx` | Yes | Visual review only (not each flow) |
| Count: helper, units in the result, conflict / recovered / already counted | `components/CountForm.tsx` | Yes | Visual review only (not each flow) |
| Fields reachable with the fixed bars (Tab, tap, scroll, shrunk viewport) | `globals.css` (`scroll-padding`) | Yes (7 viewports; fails without the rule) | Visual review only (not each flow) |
| Icon-only recompute: name, tooltip, 44 px, Tab | `components/WarehouseHead.tsx` | Yes | Visual review only (not each flow) |
| Layout: 4 widths × 2 themes, contrast, overflow, targets | all pages | Yes (56 views, 0 issues) | Visual review only (not each flow) |
| Tests and builds | `npm test`, `npm run build` | Yes (103/103; builds, also without network) | Yes (103/103, builds; `578820c`) |

### 3D heatmap (branch `m6-heatmap-3d`, from `main`; PR #8, merged as `53628f1`)

The first extension of D-014, decided in D-015: a 3D view of the same
heatmap, 2D first and as fallback. New dependency: `three` 0.186.1 (and
`@types/three` 0.186.0 for development), exact versions. No API,
migration, rule, formula or data change.

| Item | Where | CC verified | WIN verified |
|---|---|---|---|
| Same bins, plan, scores, bands and reference as the 2D view | `lib/heatmap3d.ts`, `app/page.tsx` | Yes (`node --test`; each of the 30 selections = `GET /warehouse`) | Reported by the author |
| Short columns on a fixed 0–100 scale, 0 kept as a base, no score as a dashed tile, no hidden bin | `lib/heatmap3d.ts` | Yes (≥ 91 % of every top visible in the extreme cases; 30/30 selected in the browser with all 0, all 100, alternating, checkerboard, no score) | Reported by the author |
| Direct selection by mouse and touch, details kept, list selects the same bin | `components/Heatmap3D.tsx` | Yes (30/30 at 320, 390, 768 and 1440 px, both themes, mouse and touch) | Reported by the author |
| Fixed orthographic camera, limited zoom, pan, Reset for the current size | `components/Heatmap3D.tsx` | Yes (36 interaction checks) | Reported by the author |
| Page scrolling kept (one finger, plain wheel); two fingers pan / zoom | `components/Heatmap3D.tsx` | Yes | Reported by the author |
| 2D first; back to 2D without WebGL, on a lost context or a failed download; 20 switches without leaks | `components/HeatmapViews.tsx` | Yes | Reported by the author |
| Data updates with the 3D view open (recompute, new plan) | dashboard | Yes | Reported by the author |
| Layout of the 3D view and 2D checks kept | all | Yes (8 views 0 issues; 2D: 33 flows, Count fields, chart, 56 views) | Reported by the author |
| Tests and builds, clean `npm ci` | `npm test`, `npm run build` | Yes (103 API + 11 web; builds, also without network) | Reported by the author |

### Rivy (branch `m6-rivy`, from `main` after PR #8)

The second extension of D-014, decided in D-016: a read-only assistant on
Gemini (`gemini-3.5-flash-lite`) at `/rivy`. REST with `fetch`, no new
dependency; no migration, rule, formula or data change. "Simulated" below
means against a local fake Gemini with scripted replies: it checks the
app's side (requests, tools, limits, errors, page), not the model's
answers.

| Item | Where | CC verified | WIN verified |
|---|---|---|---|
| Five read tools: stored score and breakdown; comparison with the D-011 rule and availability for a new plan; the dashboard's Top 5 (added after the Windows run); tasks and counts (score at selection apart from current, no history ≠ PASS); versioned rules | `apps/api/src/assistant/tools.ts` | Yes, simulated (figures equal to the API's; tie decided by "never audited"; Top 5 = `GET /scores/top`) | Four tools reported by the author; Top 5 pending |
| Answer check: codes, links, dates, times and numbers only from this question's tool results (not from earlier answers); otherwise withheld with a clear message; sources limited to the bins named | `apps/api/src/assistant/grounding.ts`, `assistant.service.ts` | Yes, simulated (the Windows case as a regression; 8 mutations caught); the affected cases once with the real model from CC | Pending (re-run of the affected cases) |
| Read-only: no write tool, no model SQL, unknown tools refused | `tools.ts`, `assistant.service.ts` | Yes, simulated (`create_plan` refused, database unchanged) | Pending |
| Gemini REST client: key header, model's turn sent back unchanged (thought signatures), errors mapped | `gemini.ts` | Yes, simulated; one real round trip from CC through its proxy (not Windows) | Pending |
| Limits: 2 calls, 2 tool runs, 500 characters, 800 output tokens, 30 s / 60 s, local 15 RPM guard, no automatic retry | `assistant.service.ts` | Yes, simulated | Pending |
| Errors: no key, 429, 503, timeout, refused key, blocked; rest of the app unaffected | `assistant.controller.ts`, `/rivy` | Yes, simulated (API and page) | Pending |
| Page: suggestions, answer with links only from the API, "Data as of", tools, calls, tokens, time; Try again; window of six and Clear; Enter / Shift + Enter; counter | `components/RivyChat.tsx` | Yes, simulated (67 browser checks) | Pending |
| Layout: 320, 390, 768, 1440 px, both themes; four tabs on phones; contrast | `globals.css`, `Navigation.tsx` | Yes, simulated (no overflow; contrast ≥ 5.41) | Pending |
| Tests and builds | `npm test`, `npm run build` | Yes (API 121/121 incl. 14 Rivy e2e and 4 check tests; web 11/11; builds; 6 + 8 mutations caught) | Pending |
| Real answers: the four capabilities, a follow-up and a case without data, in English and Spanish | `/rivy` with the author's key | Only the affected cases, from CC through its proxy (ranking, follow-up, rules) | Run by the author (screenshots): coherent, except the global ranking (invented bins and scores) and invented times; re-run of the affected cases pending |

Next: the author's data analysis, on its own branch. Delivery planned for
Thursday 2026-10-22; final acceptance of the whole (clean clones, version
tag) after the extensions.

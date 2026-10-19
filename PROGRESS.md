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

**Status:** implemented on branch `m3-risk-scoring`; verified in the Claude
Code environment and, on Windows, data, scores, tests and builds pass.
**Not complete:** the interface on Windows must be checked again after the
phone-width fix in `b1a0cc5` (E-001, E-009).

| Check | Implementation | Verified in CC | Verified on WIN |
|---|---|---|---|
| Formula: weights, caps, never audited = maximum, rounding once (half up), bands | `src/scoring/formula.ts` (pure) | Yes (9 unit tests) | Yes (9 tests) |
| Window `(reference − 30 d, reference]`, once per affected bin | One SQL query in `src/scoring/recompute.ts` | Yes (start excluded, +1 ms included, end included, after end excluded, move counted for both bins, adjustment once) | Yes (tests) |
| All or nothing; consistent inputs | One repeatable-read transaction; reset scores inside its own transaction | Yes (a failure while saving keeps the previous scores) | Yes (tests) |
| Demo: scores with the reset reference | `resetDemoData` | Yes (all 30 equal to the formula written in SQL; 91 / 44 / 18; caps 11 / 0 / 2; 5 / 13 / 12 by band) | Yes (reset 5 / 13 / 12; score fingerprint identical to Linux) |
| API | `GET /warehouse`, `GET /bins/:code` with `score`; `POST /scores/recompute` | Yes (tests + manual) | Yes (tests) |
| Web | Colored grid, legend, "Scores as of", recompute button; score card with "Why this score" | Yes (button recomputes 30 bins for the current time; 375 px without overflow) | Pending: interface checks after the phone-width fix (`b1a0cc5`); the earlier run noted the Points column too close to the edge |
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

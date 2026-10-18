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

**Status:** implemented on branch `m2-warehouse-data`; verified in the Claude
Code environment and, on Windows, tests and builds pass on code commit
`a1461d6` (a first Windows run failed on a test hook limit and was
corrected). **Not complete:** on Windows, the not-found state of the bin page
gave inconsistent results and needs one directed check (E-001, E-009).

| # | Criterion | Implementation | Verified in CC | Verified on WIN |
|---|---|---|---|---|
| 1 | Migration from milestone 1 and from an empty database; constraints | Migration `warehouse_inventory` in its own transaction: removes only `SAMPLE-BIN-01`, refuses other existing bins; CHECKs, unique keys and non-cascading relations | Yes (M1 database, empty database, refusal with an extra bin; constraint tests) | Yes (milestone 1 → 2 on the test database; empty database `smart_cycle_count_empty`) |
| 2 | Reproducible seed, time coverage, no future events | `generateDemoData` (seeded, `SEED_NOW` with explicit zone, UTC) | Yes (same data twice, compared by SQL and by tests; no event after the reference) | Yes (reset output and data fingerprints identical to Linux; generator tests) |
| 3 | Four movements, rejections, rollback | `applyMovement` | Yes (12 tests, incl. rollback of quantities, location, log and versions) | Yes (12 tests) |
| 4 | Independent rebuild; versions = movements per bin | Test replays the log without `applyMovement` | Yes | Yes |
| 5 | Unauthorised reset refused; rollback on failure | `resetDemoData` + `npm run db:reset-demo` | Yes (no flag, non-dedicated database, invalid `SEED_NOW`, failing rebuild) | Yes (refusal without the flag; reset tests incl. rollback) |
| 6 | API: warehouse and bin detail, 404 | `GET /warehouse`, `GET /bins/:code` (normalised) | Yes (6 tests + manual) | Yes (6 tests; pages served through the API in `npm run dev`) |
| 7 | Grid, detail, error/not-found states, mobile width | Pages `/` and `/bins/[code]` | Yes (all states; 375 px viewport without horizontal overflow) | Partly: grid and detail (author's visual confirmation), phone width (overflow 0 measured at 375 px on grid and detail), error state (visual + log); **not-found state inconclusive** (one `True`, a later `False`) |
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

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
`a501c55` (later commits only change documentation). **One Windows check is
still pending:** the bin persisting across `db:down` / `db:up` without
seeding. It becomes part of `main` when the author merges the pull request
(E-009).

| # | Criterion | Implementation | Verified in CC | Verified on WIN |
|---|---|---|---|---|
| 1 | Structure | Root workspace, one lockfile, `.nvmrc`/`.node-version`, `.npmrc`, `.gitattributes`, `.gitignore`, `.env.example` per app, `docker-compose.yml`, docs | Yes | Yes |
| 2 | Reproducible install | `npm ci` from the committed lockfile; Node/npm enforced by `engines` + `engine-strict` | Yes (Node 22 rejected, Node 24.22.0 OK) | Yes (`npm ci`; 32-bit `sharp` skipped) |
| 3 | Database | Compose service with the pinned image on host port 5433; migration `create_bins` | Yes (from an empty volume; port change with data preserved) | Yes on `a501c55` (healthy on 5433, 16.15, migrations up to date); the first application of the migration was not shown |
| 4 | Data | `npm run db:seed` upserts `SAMPLE-BIN-01`; data kept in a Docker volume | Yes (twice → one row; same row after `db:down` / `db:up` without seed) | Seed: yes (after delete and while `dev` ran → one row; idempotency covered by the tests). Persistence after `db:down` / `db:up`: **pending** |
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

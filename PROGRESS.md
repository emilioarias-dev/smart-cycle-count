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
- Ports: API `3001`, web `3000`.

**Implementation:** not started.

| Item | State |
|---|---|
| Repository documentation and root Git configuration (`.gitignore`, `.gitattributes`) | Done (first commit on `main`) |
| Root workspace, lockfile, Compose file | Not started |
| API (NestJS + Prisma, `Bin` model, migration, seed, endpoint, test) | Not started |
| Web (Next.js page, error state) | Not started |

# Decisions summary

A short overview of how Smart Cycle Count Scoring is built and why. The
full text, with alternatives and status, is in
[`DECISIONS.md`](../DECISIONS.md) (decision IDs in brackets); what was run
to check it is in [`VERIFICATION.md`](../VERIFICATION.md).

All data is synthetic, produced by a demo generator. Nothing here describes
results from a real warehouse.

## What the brief asked for, and what was added

**Required by the technical test (the PDF brief):** Next.js, NestJS, Prisma
and PostgreSQL; a seeded warehouse of about 30 bins with pallets and a month
of activity; a 0–100 score per bin with a stored factor breakdown and a way
to recompute it; a color-coded heatmap with bin details; "Create plan → Top
N" with `PENDING` / `DONE` tasks and a task table; a mobile count flow that
records PASS or FAIL and recomputes the scores; and a README covering
install, seed, run and the scoring factors.

**Added in this project (extensions agreed with the author):** the Rivero
visual identity and light / dark themes [D-013]; the Top 5 breakdown chart
[D-013]; a 3D view of the heatmap [D-015]; Rivy, an optional read-only
assistant [D-016]; two demo scenarios, original and high-risk [D-017];
motion and explicit action states [D-018]; and the Audit insights block
[D-019].

## Architecture

- npm workspaces monorepo: `apps/api` (NestJS 12, ESM) and `apps/web`
  (Next.js 16, App Router). PostgreSQL 16.15 in Docker, pinned by digest,
  on host port 5433 [E-002, E-003].
- The API owns the database: Prisma schema and migrations, the movement
  function, the score formula (one implementation), plan creation and the
  count. The web app calls the API only from its server; the browser never
  sees the API's URL [E-007].
- Every inventory change goes through one movement function, which also
  bumps the bin's `inventoryVersion` [D-008]. The demo generator uses it,
  so the movement log rebuilds every pallet and bin version [D-009].

## Risk score: a heuristic, with limits

- Four factors, weights summing to 100: time since the last audit (30, cap
  90 days, never audited = maximum), activity (25, cap 40 putaways, picks
  and moves in 30 days), adjustments (20, cap 5 in 30 days) and a FAIL as
  the latest count (25). Each capped factor is `min(input ÷ cap, 1)`; the
  total is rounded once [D-010, D-012].
- The window is `(reference − 30 days, reference]` in UTC. Only the latest
  score per bin is stored, with a breakdown that reproduces it [D-005].
- It is an **audit priority**, not a probability of error: weights and caps
  are initial choices, not calibrated with real counts, and the app makes
  no claim about predicting mistakes.
- Before a bin's first count, its "last audit" date is a simulated
  antecedent with no result behind it; no count is never read as a PASS.

## Plans and tasks

- Top N (1–30, default 5) of the bins with a stored score and no pending
  task, ordered by score, then never audited, then the oldest audit, then
  code [D-011].
- Each task keeps a copy of the score and breakdown that selected it, so a
  later recompute does not change why it is in the plan [D-002].

## Counting: what is compared, and when

- The expected inventory is the one **shown when the count was opened**.
  The form sends that `inventoryVersion`; the API locks the bin and
  compares. If a movement changed the bin meanwhile, nothing is saved and
  the operator recounts with the current pallets [D-001].
- PASS only if every expected pallet's quantity matches exactly and no
  unexpected pallet was found; the result is derived, not chosen [D-003].
- **A count never adjusts the inventory** [D-004]. A FAIL records the
  discrepancy and raises the score; a later count fails again if the
  discrepancy is still there. There is no reconciliation workflow.

## Transactions and retries

- A count is saved in one transaction with its lines, the task closed, the
  bin's audit date, and a recompute of every score at the count's time;
  if any part fails, nothing is kept [D-012].
- Scores, counts and the demo reset take turns through one database lock;
  plans take turns with each other. A recompute takes its time once it has
  its turn, so a count saved while it waited is included [D-010].
- Retries: the same count sent again is **recovered**, not saved twice;
  different quantities for a counted task are rejected. When the web app
  cannot know whether a write happened (no answer, a gateway error, an
  unreadable answer), it says "not confirmed" instead of "failed", resends
  only the exact same count, and offers no retry for a plan that may exist
  [D-012, D-018].
- The demo reset runs in one transaction, refuses non-project databases
  and deletes plans, tasks and counts with the inventory [D-009].

## Rivy: optional and read-only

- An assistant on Google Gemini (free tier) with the user's own key; without
  a key the rest of the app is unaffected [D-016].
- Read-only: five read tools over the API's own data; it cannot create
  plans, record counts, change inventory or the formula, and it never runs
  SQL written by the model.
- Before an answer is shown, the API checks that every code, link, date,
  time and number in it comes from this question's records; otherwise the
  text is replaced by a note. This is a filter, not proof that an
  explanation is right; the records shown under the answer are the
  reference.

## Audit insights

Over the **saved counts of all plans** in `(T − 30 days, T]`, where T is the
server time of the request, read in one snapshot [D-019]:

- **Coverage** = bins with at least one count in the period ÷ bins in the
  scope now.
- **Counts recorded** = counts in the period, with PASS and FAIL.
- **Observed FAIL proportion** = FAIL counts ÷ counts in the period. With no
  counts it is undefined ("No counts"), never 0 %.
- One bar per aisle splits its bins by their latest count in the period:
  PASS, FAIL or none.

The FAIL proportion describes the counts observed, not the warehouse's
error rate: bins are chosen by priority and can be counted more than once.
Nothing is inferred from simulated audit dates.

## Limits of the demo

- Synthetic data only; the numbers illustrate the mechanics, not
  operational results.
- The high-risk scenario is a target distribution for the demo (8 high,
  12 medium, 10 low at its reference time), produced with the unchanged
  formula; a later recompute moves it.
- No movement entry in the app, no user accounts, no camera scanning.
- Tested on Linux and Windows; macOS was not run (see the README).

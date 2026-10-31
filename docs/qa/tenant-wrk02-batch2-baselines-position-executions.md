# WRK-02 Batch 2: workforce plan baselines and controlled position execution

**State:** DRAFT / NO-GO, independent security acceptance pending.
**Canonical target:** `main@a0cd5b9d81966d55cbca1124209ffaa3205d22a9`.
**Family:** WRK-02 planning write isolation, not onboarding, workforce demand, HR discipline, asset custody, billing or delegation.
**Methods under test:** `POST /api/workforce-planning/baselines`, `POST /api/workforce-planning/position-executions`, `PATCH /api/workforce-planning/position-executions`.

## Deliberate zero-credit, no-route-change proof

The source already has a company-wide People-admin gate, exact-organization SQL selectors, baseline version lock, exact execution-hash revalidation and final status predicates. This proposal adds a **new** disposable PostgreSQL 16, Next production-mode, localhost signed-in HTTP runner, a contract test and workflow. It does not alter existing route sources, schema, payroll, provider behavior or shared coverage manifest. These three methods remain **GAP** until exact-head CI, independently reviewed own-positive and real-victim-denial evidence are accepted, at which point a *separate, explicit* manifest-credit review is necessary.

The scenario/plan/job/position prerequisites are real, synthetic SQL fixtures, inserted against a pristine disposable database; a marked, already-**approved** scenario stands in for prior Batch 1 steps. This proves **Batch 2 only**, not approval-chain configuration, scenario creation, scenario submission, actual human approval or Batch 1 tenant correctness. Do not import or reuse these fixtures in production.

## Proof controls

- Two independent signed-in employer owners A/B, a real higher-ID victim employer, and a fourth excluded employer. Real database-generated IDs, not guessed target IDs.
- Own `201` published baseline with exact employer, plan, scenario, version, hash, and position source. A same-scenario concurrent `POST` proves one 201 and one 409, not two publications.
- Real foreign approved scenario ID returns 404. Invalid/anonymous attempts are denied with unchanged SQL.
- Own `201` position execution preview has a genuine `planned -> approved` SQL update action, **without** mutating the position during preview. Same state returns exact reused preview without another write.
- Foreign tenant plan, forged victim plan under an attacker organization, and real higher-ID victim execution IDs deny both `apply` and `cancel`. No protected source records or audit rows change.
- Own `PATCH cancel` persists cancelled, rejects double decision, and an authorized `POST` reopens the exact-hash preview.
- Own `PATCH apply` updates the actual intended position to approved and records the expected execution and audit. A second apply is rejected, not replayed as a new write.
- A newer owned approved synthetic scenario publishes version 2; applying the **old** preview fails 409 with every business, payroll and audit record unchanged. An execution preview created from the new baseline succeeds and applies.
- Revoked employer membership is denied across all three methods while the same user account session remains active.
- Every cross-company denial is checked against real persisted victim/peer payroll, position, baseline, preview, employee and audit records. Controlled own success is checked to leave other employers untouched.
- Exact source Git blobs are pinned in the contract test, together with the existing zero-credit manifest statuses.

## Safety constraints

GitHub Actions checks out exactly the PR head, starts only a disposable PostgreSQL 16 service at `127.0.0.1:5432/app_db`, and serves Next solely at `127.0.0.1:3000`. The executable refuses unsafe environments before any application or DB import. No real external API, provider token, payout, pay release, worker scheduler, Neon, Vercel deployment or remote DB access. The suite contains **no production-readiness certification**.

## Independent security acceptance gate

- [ ] Source-pin and contract tests pass on the exact PR head.
- [ ] Real synthetic PG16 HTTP runner finishes with `WRK02_BATCH2_HTTP_COMPLETE`.
- [ ] Reviewer checks genuine independently authenticated own responses and existing victim-only SQL selectors, including both PATCH actions.
- [ ] Reviewer inspects baseline publication race and stale execution 409 snapshots. A green static test or feature-OFF 404 does not count.
- [ ] All non-actor employer payroll, positions, audit and session grants remain unchanged by other employers' operations.
- [ ] Coverage owner independently decides whether each **whole method** satisfies all actions, races and forged selectors. Only a separately approved manifest update may award credits.
- [ ] Maintain DRAFT and do not merge or deploy before security review.

**Known boundary:** An existing `PATCH /position-executions` path distinguishes an unknown execution ID (404) from a real unauthorized foreign execution ID (403). This proof does not silently certify resource-existence privacy; security reviewer must explicitly assess whether uniform 404 should be a separate source-hardening follow-up. The test asserts foreign 403 with unchanged victim data and no foreign marker, not invisible resource existence.

Rollback: close or revert the isolated QA PR. No migration or data backfill.

# HR Cases PATCH employer-isolation proof — fictional PG16 only

**DRAFT / zero API method credits / zero page credits / no production or security acceptance.**

## Why this is new work, rather than a duplicate

The merged HR Cases page probe covers SSR and GET inbox **reads**, not PATCH.
The existing source contains employer/membership, role, unit and linked-worker
guards for the PATCH handler, but that is not itself executed evidence that
unauthorized requests cannot mutate real case rows, private notes or audit data.

This PR supplies a separate, exact-head CI job for **PATCH /api/hr-cases**.
It does not change any app runtime route, the read-only proof, the coverage
manifest, release flags, credentials, financial routes or source pin baselines.

## Executed behavior required before credit can even be discussed

The CI job must build a production-mode Next app only on `127.0.0.1`,
connect to a freshly empty disposable PostgreSQL **16** `app_db`,
and enforce exact, source-pinned runtime/contract inputs.
The HR Cases feature is ON **only in the synthetic CI process**.
Multi-entity mode, document vault/COE approval, payout providers, workers,
scheduler, real messaging and payroll release remain OFF.

The real HTTP runner must demonstrate all of the following:

1. Seven populated filler employers, two independently signed-in owner
   employers, and a populated higher-ID victim. No placeholder-only rows.
2. Four legitimate persisted PATCH actions: own HR reply by owner A,
   own HR reply by owner B, own internal note by a scoped HR reviewer,
   and own payroll case status transition by a payroll reviewer.
   Assert response organization and ID, actual message/status changes,
   durable audit event and unchanged victim tables.
3. Thirteen real refused PATCH requests, including both attackers attempting
   other employers' cases, forged victim organization/employee hints,
   HR-vs-payroll and payroll-vs-HR confidentiality, another authorized
   department, bookkeeper, anonymous, invalid IDs and revoked membership.
4. On **every** refused request, the complete protected SQL snapshots for
   all attacker and victim employers remain byte-equivalent, including
   HR cases, notes, employees, audit events and payroll runs.
   The response must not render a foreign employer's marker.
5. The revoked owner remains authenticated at `GET /api/account` but
   loses permission to PATCH their employer's cases immediately afterward.
6. Contract tests deliberately reject fake success status, leaked victim
   markers, altered protected snapshots, altered source pins and unsafe
   environments. A disabled feature or negative-only 404 never counts as
   owned success.

The runner's successful terminal JSON is **a development proof proposal**,
not independent acceptance. The workflow will fail on a counterexample;
any such failure must be investigated and fixed without loosening assertions.

## Explicit omissions and gates

- This is a **PATCH** method probe, **not full POST/GET method acceptance**.
- It does not cover document vault COE issuance, signed approvals, external
  object storage, real email, SSO, live money or the complete UI interaction.
- It does not certify in-flight concurrent membership revocation, worker-unit
  transfer, or case reassignment. Those TOCTOU conditions need a separate
  reproducible concurrency test before making a race-safety claim.
- Existing source SHA receipts remain unchanged. If main or the route changes,
  run source reconciliation and review the diff; never waive a pin.
- Keep PR draft until **exact head** CI, standard tests, CodeQL and security
  checks are actually green. Independent HR/security review, staging and
  production authorization remain separate.
- Do not promote the page or the method to COVERED solely based on this probe,
  merge automatically, deploy, activate provider integrations or use live data.

**The point is to find and prevent actual cross-employer writes, not to
inflate tenant-isolation totals.**

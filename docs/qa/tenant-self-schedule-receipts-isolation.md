# ESS schedule receipt tenant isolation — disposable HTTP evidence candidate

**Status:** DRAFT / ZERO method coverage credits / NOT ACCEPTED / NO PRODUCTION OR PAYROLL CHANGE.

## Scope

Exactly two currently GAP methods on `main`: `GET /api/self/schedule-receipts` and
`POST /api/self/schedule-receipts`, part of the PII-02 frozen tenant-isolation queue.
The route remains **unchanged**. It already binds the selected employee to the signed-in
session, checks active membership, rejects all query selectors and unrecognized POST
body keys, and calls a transaction-scoped second identity check. This PR supplies
additional live HTTP and disposable PostgreSQL assertions rather than claiming
a new exploit or changing security controls without evidence.

## Executable isolated evidence

`.github/workflows/tenant-self-schedule-receipts-http.yml` uses a **new empty,
disposable PostgreSQL 16** service, reviewed offline baseline, production-mode
Next.js bound only to `127.0.0.1:3000`, and a test-process-only receipt pilot
allowlist for fictional organizations 1, 2, 3. The source runner refuses any
other database URL or app host, absent GitHub Actions attestation, enabled
workers/scheduler, payout/billing flags, or live provider credentials **before
importing database modules**.

`scripts/qa/tenant-self-schedule-receipts-http.mjs` must establish:

1. Real, distinctly authenticated employee and peer accounts within attacker
   employers A and B; victim employer C seeded last with real higher organization,
   employee, shift, and override IDs, not invented victim resource IDs.
2. Populated legitimate own `GET 200` for both attackers and their peers, with
   employee-specific current schedule names, persistent shift IDs, exact current
   work date and content hash; independent victim `GET 200` positive control.
3. Client-forged victim organization/employee/user query selectors `GET 400`.
   Same-employer peer and cross-employer private schedule content must be absent.
4. Legitimate `POST 201` for each separate attacker, verified against the exact
   PostgreSQL `workforce_schedule_receipts` row and exactly one actor/employee/
   work-date/hash-bound audit event. Duplicate `POST 200` is idempotent and
   cannot create a second receipt or audit.
5. Forged victim employer/employee body or query `POST 400`; stolen genuine
   victim schedule hash `POST 409` without receipt; owner role `403`;
   anonymous `401`; and a forged user linked to a real victim employee but
   holding **only an attacker membership** `403` on both methods.
6. Previously authorized Alpha employee keeps the **same session** and an
   active secondary Beta membership; after Alpha membership is deactivated,
   both Alpha methods return `403`, while the real Beta employee continues to
   read their own acknowledged schedule.
7. Compare real PG snapshots of the genuine victim's employee, membership,
   overrides, shifts, receipts, audit, and payroll before/after every negative
   test. Assert no changes to protected employer rows and no private marker in
   denied responses. Positive acknowledgments may mutate only the own receipt
   and own audit event, not payroll or attendance.

## Verification and limitations

- The fail-closed contract is guarded by
  `tests/tenant-self-schedule-receipts-contract.test.mjs` and is executed
  **before** the real HTTP job. The test includes adversarial false-positive
  fixtures, exact handler/service guard anchors and checks that both manifest
  methods remain `GAP` with `testedBy: null`.
- The test is also discovered by the repository's complete `tests/*.test.mjs`
  sharded CI. New workflow execution is required in addition to a green build.
- Do **not** claim proof until actual **exact PR HEAD** checks show successful
  independent PG16 + real HTTP execution, full `CI/check`, CodeQL,
  Security HTTP Smoke, Payout Payroll Isolation, and any applicable branch rules.
- A separate human security/privacy review must confirm the handler scope,
  unexpected failure statuses, test logs and the original PII-02 batch contract.
  This bounded recovery does **not** complete the whole PII-02 batch or upgrade
  two methods to `COVERED`; a later manifest-credit change must be reviewed
  independently if the accepted evidence warrants it.
- No Vercel deployment, production Neon, live employee identity, payroll run,
  provider, remittance, money transfer, migration, release flag or user account
  is changed or used. Receipt acknowledgment means only **seen**, never shift
  acceptance, time attendance or wage approval.

**Owner disposition:** Keep this PR DRAFT until tests and independent review
establish the exact observed outcomes. Record any red job as a failure requiring
repair; do not disable or loosen the existing security/payroll gates.

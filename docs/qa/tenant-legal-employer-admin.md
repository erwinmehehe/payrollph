# Legal-employer administration tenant proof

This batch targets five previously GAP methods in a family with no overlapping
open PR at selection: PATCH context, PATCH settings, and GET/POST/PATCH
registration-changes under `/api/multi-entity/`. It reuses the existing context
and registration-read rows instead of duplicating them. The committed
[local receipt](tenant-legal-employer-admin-receipt.json) pins every exact row and
the shared assertion helpers. The credit script generates the manifest and
inventory; no counts or method statuses are manually edited.

## Executed scope

Two independently authenticated fictional owner employers and a genuine higher-ID
victim run against localhost and disposable WSL PostgreSQL 18.6. Read and write
runners each execute four rows, eight own/foreign pairs, and four cross-attacker
discrimination checks. The write runner additionally executes eight forged-ID
denials. Only the five GAP identities receive new provisional credits; already
covered reads retain their provenance.

- Context: persist exactly the owner's granted legal entity preference and audit;
  deny foreign employer, forged foreign entity, and owner-wide `all` selection.
- Settings: persist only the legal employer's pay schedule and exact audit; deny
  foreign entity, preserve permissions/employee pay profiles/payroll, prove an
  idempotent request writes nothing, and refuse unversioned identity changes.
- Registration history: return genuinely persisted pending and historical
  requests plus a populated, employer-distinct version. Assert all public fields,
  maker/checker ownership, no decrypted profile/envelope, and no victim metadata.
- Registration proposal: persist all ten supported fictional fields in an
  encrypted pending proposal and exact audit. No master, history, or payroll
  mutation is allowed. Refuse foreign employer and forged entity selectors.
- Registration decisions: execute **reject and approve** for both attackers,
  with a separate historical maker and authenticated checker. Approval must
  atomically update the correct employer, seal its fictional bank value, create
  an immutable encrypted version, and append exactly the expected audit. Refuse
  foreign requests, forged request IDs, self-approval, and replay; prove these
  denials leave both employers unchanged. Approval's additional positive proof
  must also reject the other attacker's genuine result.

The independent maker fixture has no usable password or login session. Existing
MFA, same-origin, grant, rate-limit, tenant and audit guards stay intact. No
application route, schema, migration, runtime flag or financial release switch is
changed. QA flags apply only to the existing disposable multi-entity profile.

## Acceptance and reproduction

A deliberately empty PATCH settings expectation was run against real HTTP and
rejected with `expect accepts another employer's data`. Restore the expectation,
reset the fictional DB, rerun both multi-entity runners, and regenerate the
receipt before any renewed credit. Existing cited primary shared-runner
assertions retain both their text and line numbers; the frozen-runner regression
still hashes every original byte after removing only exact reviewed additions.

Use the guarded local database/build/server tools described in
[the family workflow](tenant-family-proof-workflow.md). Keep one random bank key
and PII key shared by server and runner. Apply the already reviewed SQL-only
HCM fixture with `tenant-read-recovery-local-setup.mjs` before shared snapshots.
The existing CI workflow runs the same rows under disposable PostgreSQL 16.

Generate credits only after the actual run, using
`tenant-table-credit.mjs --legal-employer-admin --local-postgres-major 18`, the
receipt's exact `--run-label`, and all five exact `--only-key` values. Receipt
validation refuses missing approval actions, absent victim invariants, a missing
mutation rejection, wrong engine, or changed source hashes. Review the generated
manifest before merge.

**Exact-head PostgreSQL 16 CI is NOT_RUN at authoring.** Local PostgreSQL 18 is
not represented as PG16 evidence. This is provisional local proof, not global
tenant-isolation acceptance, live payroll authorization, a bank integration, or
verification of production data. Only fictional data was used. The original
local database is parked and restored by its exact initial name without dropping
either the original database or the fictional evidence database.

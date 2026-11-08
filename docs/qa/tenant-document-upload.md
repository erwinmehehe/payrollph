# DL-01: standalone document upload tenant-isolation candidate

**Status: DRAFT, zero tenant-coverage credits, independent security/privacy review PENDING.**

This family exercises **POST /api/documents** only. It is not the enterprise administration, account email, billing, payroll, HCM SLA, database-target readiness, or marketing operator family. It changes no application route, shared coverage manifest, source inventory, database migration, storage provider, feature default, or production configuration.

## Exact bounded proof

A dedicated CI workflow starts a disposable PostgreSQL 16 database and a production-mode Next.js server on localhost, creates two independently authenticated fictional employers, then a **third higher-ID persisted victim** with its own worker, requirement, compliance record and pre-existing PDF bytes. It tests:

- Own persisted legacy multipart PDF upload with a SQL document row and a matching audit receipt for **each attacker**.
- Own assigned document requirement upload with a tenant-, employee- and requirement-bound compliance transition; two additional successful writes.
- Foreign employer selector, persisted foreign employee ID, persisted foreign requirement ID, anonymous request, and invalid PDF signature all denied for **both** attackers, with before/after SQL snapshots unchanged.
- A real disposable PostgreSQL audit INSERT veto on each attacker's employer must roll back the entire document/compliance/audit transaction, not merely change the HTTP result.
- A byte-for-byte snapshot of the victim's documents, HR compliance, employee, pay profile, payroll, audit and outbox records, plus per-action checks that non-actor employers never change.
- Existing legacy-upload route pinned to Git blob cd8d559e9186ddae6c0f00e7af4bc4c4f5e37d38. Source drift fails the contract instead of silently inheriting evidence.

The scanner is an explicitly **fictional process-level intercept** recognizing only short synthetic PDF test payloads. It never sends files to a real scanner or network provider, never contacts a real tenant, and **does not prove malware-scanning effectiveness or provider integration**. The private object-storage vault remains disabled. A test guard refuses remote databases, provider secrets, real workers, any non-loopback app, missing CI, and non-fixture scanning configuration.

## Gate to any future coverage credit

- [ ] Exact-final-head CI (including the dedicated PG16 HTTP job) passes.
- [ ] Human security/privacy review verifies the multipart, scan, tenant and audit boundaries and checks every reviewed source SHA.
- [ ] Confirm whether the current legacy POST covers every enabled path, including private object storage. This suite **does not** test private vault behavior.
- [ ] Independently reconcile with the then-current main, open-PR files and shared manifest before proposing any status change.
- [ ] Any coverage ledger change, production flag activation, hosted scanner acceptance, deployment or merge requires a separate reviewed decision.

Current manifest classification stays **GAP / testedBy: null**; this candidate earns **zero** credits. It does not certify platform-wide tenant isolation or grant approval for real employee document uploads.

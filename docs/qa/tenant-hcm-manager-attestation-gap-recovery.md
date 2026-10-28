# Tenant isolation API recovery — HCM manager-attestation GET

**Status: candidate / GAP / zero credits until independently reviewed executed proof.**

## Recover exactly one API method, not a whole handler

- **Target:** `GET /api/hcm/employment-term-decisions/[id]/manager-attestation?organizationId=...`.
- **Current canonical manifest:** GAP with `testedBy: null` at the reviewed `main@a7dc1f5184f59f3c5ac348e37b4ca88810f10651` base.
- **Not included:** the same handler's `POST` (MFA, managerial submission, employment decision and evidence-event writes); it stays GAP.
- **No production route change:** the GET already checks current session, role, employer authorization, the actual path decision ID and employer-bound rows. We strengthen evidence rather than modifying an apparently safe handler without showing a defect.
- **No collision:** existing open PRs #1501/#1505/#1507/#1508/#1509/#1510 and others address different method identities. This adds a standalone runner, its isolated workflow, a focused test and this QA record; no shared table files, source-truth manifest or other method receipts are edited in the initial proof commit.

## Executable four-part proof

The dedicated [source runner](../../scripts/qa/tenant-hcm-manager-attestation-recovery-http.mjs) and [isolated workflow](../../.github/workflows/tenant-hcm-manager-attestation-recovery.yml) use only disposable PostgreSQL **16**, three new fictional employers and a production-mode Next server bound to **127.0.0.1**. The runner **refuses non-CI, nonlocal databases, live provider credentials, disabled safety switches, and nonlocal HTTP before importing the DB/application**.

1. **Own-positive:** Two independently authenticated company-owner sessions GET their own actual pending employment decision. Every owner has one persisted distinct attestation and reporting-line snapshot, with exact manager/worker/decision ID, statement, recommendation and organization ID checks. A genuine third owner proves the higher-ID victim's source exists and is readable by its authorized owner. The second attacker cannot use the first's real HTTP response as proof.
2. **Genuine-victim denial:** Both attackers select the victim's actual higher-ID employer **and path decision ID** and receive 403 with no victim statement, secret or attestation list. An own decision path combined with a real foreign employer selector is also denied 403. A same-employer employee without manager or People-admin authorization is denied 403 and an anonymous caller receives 401.
3. **Forged-selector rejection:** Both attackers keep their real own employer selector but place the **victim's actual higher-ID decision ID in the PATH**; this must return **404**. Substituting the second attacker's real decision ID likewise returns 404. Extra forged victim decision/worker/manager/user query selectors cannot override an actual OWN path and employer ID: the authorized response must match the real own reply byte-for-byte at the JSON level.
4. **Unchanged victim database:** Before/after exact SQL snapshots are compared for the victim **and both attackers**, including actual attestations, employment decisions and terms, reporting-line positions and assignments, job profiles, staff, pay profiles, memberships, organization, entity, unit, audit business rows, payroll runs/entries and payout batches. No decision, approval, worker status, wage, audit or payroll row may change because of GET.

The fixture is entirely fictional and ephemeral. No connection to Neon, customer/production databases, actual employees, bank accounts or external payment providers is allowed. No real money moves.

## Source and exact-head acceptance gates

- [ ] Exact-HEAD Node source, fail-closed and negative controls pass in the [focused test file](../../tests/tenant-hcm-manager-attestation-recovery.test.mjs).
- [ ] The new dedicated PostgreSQL 16 and localhost HTTP workflow passes on **this PR's final head SHA**, with full four-part method receipt.
- [ ] Main CI, CodeQL and Security HTTP Smoke are reviewed; failed or pending jobs are not called green.
- [ ] Independent domain/security reviewer checks the GET route and its library source blobs still match the manifest, the proof is sufficient and all supported GET modes are exercised; POST remains GAP.
- [ ] Only after the above, a reviewable separate GAP-to-COVERED manifest change adds precise **own-positive, foreign denial, stolen-path rejection and unchanged-victim source line** pins plus the executed exact-head run URL. Recheck the CURRENT main manifest first for duplicate credit. Full tenant isolation stays **NOT ACCEPTED**.

**DRAFT / NOT ACCEPTED / DO NOT MERGE AUTOMATICALLY / ZERO CREDITS ON INITIAL PROOF.**

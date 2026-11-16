# PayrollPH — pilot readiness decision and execution plan

**Checkpoint:** 2026-11-16, approximately 22:15 Asia/Manila (source observations; not an executed release acceptance)
**Repository:** `erwinmehehe/payrollph`
**Reviewed main:** `18e807af43da73a7de700b27a405d6d68c1e972f` (2026-11-16 14:08 UTC)
**Decision:** **NO-GO for real-money payroll, government filing, production activation and GA.** **Conditional GO only to prepare** a private, permissioned, no-money shadow-pilot evidence pack. Do not start a real-employer run until the pilot entry requirements below are met.

## Executive status

Linaw/PayrollPH has an extensive integrated HRIS, WFM, HCM and payroll codebase. Several code, source-only and fictional-test deliverables merged on November 16. Engineering progress must not be confused with human, payroll-law, agency, tenant-privacy, employer or production acceptance.

| Area | Evidence observed | Decision |
| --- | --- | --- |
| Main/source | `main@18e807af43` merges #1993's **unregistered, default-OFF** DOLE/OSH/protected-case pilot. #1994 offline pilot pack, #1997 test fixtures, #1998 unwired 13th-month library and #2000 limited 2026 statutory smoke merged. | Source progress only; none is a live-feature or payout release. |
| Current main CI | At one observation, latest SHA's 20 GitHub workflow runs had 12 successes, 2 failures and 6 in progress. Failures: Marketing Browser QA Playwright install on unsupported `ubuntu26.04-x64`; Live RBAC Sandbox Smoke waiting for exact production deployment. This is a time-specific observation; rerun/check exact latest SHA. | **NOT ACCEPTED**. Differentiate infrastructure/browser runner failure from actual app regression. |
| Financial math | #2003 documents a reproduced **first-cutoff SSS projection mismatch** for `PHP 5,249.99/month`: projected first-cutoff `PHP 137.50` versus independent `PHP 125.00` reference under a different source assumption. Other odd-cent and bracket boundary cases remain. | **P0 BLOCKED** pending *two-cutoff* factual reconciliation and an independently reviewed decision, not a changed test expectation. |
| 2026 statutory parity | #1999 requests 2026 effective-date/worker-class source matrix, two complete fictional months, full engine/payslip/GL comparisons, independent Philippine reviewer. #2000 is limited smoke, #1997 2025-dated fixture. | **P0 NOT COMPLETE**. Primary PhilHealth source and centavo split remain unverified. |
| Wages + tenant proofs | Draft #1989 at `8fa3f6d85f11` (as last seen) has tenant-ledger evidence hold: 75 GAP methods, no renewed credits; at observation 65 success, 4 in progress, 1 cancelled, 1 skipped, 0 failures in the head-SHA workflow query (outcome subject to change). | Do not promote held tenant coverage, approve rates by default, or merge without final applicable checks and independent reviewer. |
| DOLE 13th-month screen | Ready-for-review PR #2002 `65378608afc1` had 19 successful/1 skipped exact-SHA workflows as observed; its scope is **read-only screening**, not actual 13th-month pay calculation. | Maintainer/security/domain review required; no production authorization. |
| Production deployment | Open #1974: Vercel integration resource provisioning fails **before build**. The separate synthetic demonstration does not demonstrate a working production release. Connected Vercel inspection during this checkpoint returned 403 for team `payrollph`; a team-access authorization attempt returned 404, so no current live production state was independently verified here. | **P0 BLOCKED**. Owner/operator must identify provider/resource through Vercel project and support before a controlled exact-SHA verification; do not repoint Neon. |
| Security/privacy | Post-merge acceptance #1966, tenant-isolation acceptance #1740, and release #112 remain open. Historic coverage statistics vary by dated snapshot; never call a historical inventory current or convert code/metadata into signed acceptance. | Independent cross-employer/role and privacy acceptance still required. |
| Employer evidence | #579 explicitly says real-employer no-money reconciliation **NOT RUN**. Unassigned shadow pack doc says no employer has been selected. | **NOT RUN**. Do not imply any customer participated. |

## Immediate execution queue (do in this order; independent tracks may proceed concurrently)

### P0-A — Financial correctness: #2003 / #1999
**Engineering:** Freeze new pay behavior and produce a purely fictional, disposal-database dual-cutoff proof for salary boundary values `5,249.99/5,250.00`, `14,749.99/14,750.00`, `34,749.99/34,750.00`; plus `C02/C10/C16` centavo carry, variable-pay and hourly/daily variants. Use separate PG16 and PG18, genuine engine calls, first-cutoff release snapshot, second-cutoff true-up, employer + employee SSS/EC/MPF, full gross/net/WHT, payslip and GL comparisons in integer cents. Include per-case input, independent source expectation, actual result, delta, reason, official source/effectivity, and `AGREES/DISAGREES/SOURCE NOT VERIFIED/NOT RUN`. Keep the 2026 source-date matrix and two-month whole-engine runs in #1999; do not confuse first-cutoff provisional estimate with final SSS monthly obligation. 

**Acceptance:** No unexplained centavo difference, correct actual monthly SSS bracket, tested second-cutoff correction, source-backed policy and independent qualified PH payroll reviewer signoff. Create a separate, narrowly reviewed calculation change only if supported; rerun source-pinned tenant/security checks. *Owner:* Payroll engineering + independent PH payroll reviewer. *Status:* OPEN.

### P0-B — Production integration: #1974
**Operator:** In Vercel `payrollph` team, identify the exact failing integration/provisioning resource from deployment details / Resources and Integrations. If invisible, ask Vercel Support using #1974's deployment/project IDs. Restore approved authorization/resource/billing **only after** an operator confirms the provider, existing production DB endpoint and rollback policy. Do not rotate/disclose secrets in GitHub, disconnect or switch the database, deploy blindly, run production SQL or bypass release gates. After underlying repair, verify reviewed exact SHA, CI, production READY state and post-deploy protected probes in a separately authorized change window.

**External access boundary:** During this report, the connected Vercel account lacked access to the team (403) and a team consent request returned 404. This is an access limitation, **not** evidence about which provider failed. *Owner:* Vercel team administrator / deployment operator. *Status:* BLOCKED BY TEAM ACCESS + RESOURCE IDENTIFICATION.

### P0-C — Complete exact-head test and PR review
**Engineering:** Recheck `main@18e807af43` workflow verdicts, remediate unsupported Playwright runner image and confirm browser proof, distinguish production wait-gate failure from app authorization test. For #2002, finish maintainer/security/financial-domain review of read-only screening and verify exact-head tests before any merge. For draft #1989, investigate the latest exact-head workflow result, retain all 75 held credits until new source-bound real HTTP/PG proofs and a separate reconciliation, and avoid promoting a held method in order to make dashboard numbers green. *Owner:* CI/security and PR maintainers. *Status:* PARTIAL/BLOCKED.

### P1 — Readiness and independent employer admission: #112 / #579 / #988 / #691
**Owner + independent payroll/HR/security:** Keep real money, payouts, automatic provider communication and agency submissions disabled. Confirm secure HTTPS deployment, MFA, account/key/PII protection, transactional email and demo isolation with authorized operators. Complete protected multi-tenant and human/physical phone UAT, and separately verify rollback/DR evidence. Reconcile real employer payroll only after explicit consent and compliance review; do not substitute fictional CI for external evidence.

## First-employer shadow pilot — what can be prepared now

Use the **existing** `docs/launch/first-employer-shadow-pilot.md` and `scripts/qa/first-employer-pilot-pack.ts`; **do not build a duplicate verifier**.

1. **Recruit and authorize** one consenting Philippine private employer, one legal entity, site and region, 1–25 fixed monthly-salary employees, and two **completed** pay months. The original payroll provider stays authoritative. Record correct wage region/tier, sector/size, cutoff calendar, actual worker scope and any unsupported cases.
2. **Create private evidence storage** outside repository/CI/synchronized public folders; use encryption, restricted access and approved retention. Set up distinct Owner, Payroll Officer, HR/time reviewer and independent Checker with genuine authentication and MFA; do not store names, bank details, statutory IDs or secrets in GitHub.
3. **Prepare empty pack** on a secured supported Linux host using documented `prepare` and `check` commands. Its initial `BLOCKED / NOT_RUN` exit is expected and correct; generated templates contain no invented people, months or proof.
4. **Collect matching source inputs** from incumbent and PayrollPH. Normalize **four** authentic source-derived files per month: incumbent payroll, PayrollPH payroll, incumbent GL journal, PayrollPH GL journal, using HMAC-pseudonymous worker keys and recorded file hashes; never substitute same-source exports for independent comparisons.
5. **Compare both months and all cutoffs**, worker-level gross-to-net/statutory amounts and journal controls. Explain *all* nonzero differences; independently review any discrepancies and do not rely on the tool's existing one-cent comparator tolerance as legal approval.
6. **Observe human journey**: hire/onboard, schedule, clock, approve time, run payroll, independent check, release records only, draft government evidence only — include physical-phone, tenant-switch, error/recovery and role-separation tests. Produce **no money movement**, live bank file submission, agency filing, or external certification claim.
7. **Record result**: `BLOCKED`, `ARITHMETIC_RECONCILED_REVIEW_PENDING`, or human-approved scope-specific decision based on real evidence. Automated success is **never GA approval**; human employer/qualified reviewer/safety/ops signoffs remain separate. Full GA demands additional actual agency receipts, bank UAT, production-like recovery and signed release decision.

## Go/no-go decision matrix

| Proposed action | Current decision | Conditions to change |
| --- | --- | --- |
| Continue non-production fictional financial tests and code review | **GO** | Disposable DB, no sensitive records, exact-SHA evidence, flags kept OFF. |
| Prepare private shadow pack without employer data | **GO** | Approved secure private host/storage; preserve fail-closed semantics. |
| Start authorized employer no-money shadow calculation | **HOLD** | Consenting employer + privacy review + secure isolated app + validated scope/statutory policy + distinct reviewer and pilot admission signoff. |
| Activate DOLE/OSH/confidential cases in real employer route | **NO-GO** | Dedicated counsel/DPO/OSH review, migration/tenancy/flag/phone proof and explicit signed activation. |
| Re-enable live payroll release/payment or submit agency returns | **NO-GO** | Independently verified payroll, live environment, privacy, bank/agency receipts, employer and release authorities. |
| Claim generally available or certified payroll | **NO-GO** | All `PILOT_GATES.md` and `docs/payroll-certification/production-ga-gates.md` evidence, exact commit binding and final out-of-band signed release. |

## Evidence and links

- Main commit: https://github.com/erwinmehehe/payrollph/commit/18e807af43da73a7de700b27a405d6d68c1e972f
- [#2003 SSS/centavo](https://github.com/erwinmehehe/payrollph/issues/2003) / [#1999 current statutory parity](https://github.com/erwinmehehe/payrollph/issues/1999) / [#1974 deploy](https://github.com/erwinmehehe/payrollph/issues/1974)
- [#112 launch blockers](https://github.com/erwinmehehe/payrollph/issues/112) / [#579 real parallel evidence](https://github.com/erwinmehehe/payrollph/issues/579) / [#988 physical-phone UAT](https://github.com/erwinmehehe/payrollph/issues/988) / [#691 WFM](https://github.com/erwinmehehe/payrollph/issues/691)
- [#1989 wage source + held tenant evidence](https://github.com/erwinmehehe/payrollph/pull/1989) / [#2002 DOLE screen](https://github.com/erwinmehehe/payrollph/pull/2002)
- [#1994 pilot pack](https://github.com/erwinmehehe/payrollph/pull/1994) / [first-employer instructions](../launch/first-employer-shadow-pilot.md) / [GA gate](../payroll-certification/production-ga-gates.md) / [PILOT_GATES](../../PILOT_GATES.md)

**Report limitations:** GitHub and workflow metadata were inspected; no local full build/test execution, no private real-employer evidence review, no current Vercel project read (team-access error), no production secret inspection, no schema/DB operations and no deployment. Snapshot metrics are time-bound and must be refreshed against the exact reviewed head. The report is an execution handoff, **not** an independent financial/legal/privacy or production acceptance receipt.

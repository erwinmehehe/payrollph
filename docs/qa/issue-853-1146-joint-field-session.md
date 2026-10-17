# PayrollPH #853 + #1146 — joint fictional-employer acceptance field session

**Execution status: NOT RUN / NOT SIGNED OFF.** This is an operator handoff, not an observation report. No browser/device session, real object-provider test, human sign-off, bank/payment transfer, payroll submission, or production activation is asserted by this file. Both linked issues stay **OPEN / NO-GO** until their own primary evidence is accepted.

Use the *existing* [canonical #853 27-case v2 private evidence ledger](issue-853-two-employer-operator-acceptance.md). **Do not create another #853 ledger or extend its canonical 27 rows.** Record #1146's 16 hands-on outcomes and #928's external-provider acceptance separately in a QA-owned encrypted evidence vault outside this repository. The #853 independent human witness requirement still applies; #1146 separately permits a maintainer to be its hands-on tester.

## 1. Safe test boundaries and ordered environments

| Phase | Running app and storage | Allowed claim | Not an acceptable substitute |
| --- | --- | --- | --- |
| A — #853 journey | Isolated fictional PostgreSQL 16, two employers, actual role logins; payouts, bank/provider operations, government filing and real data disabled | Human-observed 27-case journey *only after* independent field verification | Simulated clock, synthetic Chromium, historical CI or PR SHA |
| B — #1146 hands-on | Separately attested fictional-only QA app; enable vault/upload **only in the isolated QA environment**, with private test object store and controlled scanner; same reviewed code SHA if combining observations | Real desktop and physical-phone human observations for 16 vault controls | MinIO and stub-scanner CI alone, browser emulation, production flags |
| C — #928 real provider | Explicitly approved, isolated **real staging** S3/R2-compatible provider and real scanner; contractual and DBA/DPO controls in place | Provider/storage/recovery/privacy review after reproducing actual failure modes | Mocked S3 DELETE, offline scanner response, a GitHub Actions green badge |

Never point the fictional launcher at Vercel production, an existing Neon default database, a shared or copied customer environment, a public Funnel, or a payroll/bank/agency integration. The private phone route is [Tailscale Serve under verified restrictive ACLs](uat853-tailnet-phone.md); the app/PG lab is [local-only](uat853-local-lab.md). A named tester must inspect the actual route and effective security configuration; existence of the scripts does not establish a working endpoint.

**Production rollout remains forbidden:** `EMPLOYEE_DOCUMENT_VAULT_ENABLED` and `DOCUMENT_UPLOADS_ENABLED` must remain OFF outside expressly authorized isolated QA. Do not use genuine identity documents, employee data, real SSS/BIR/PhilHealth/Pag-IBIG submissions, banking details or payouts.

## 2. Freeze the served build and private session record first

The QA custodian independently records the following from each *running* environment; missing proof blocks observations rather than being filled with assumptions:

- Exact **served/deployed** 40-character commit SHA matched to an inspected clean checkout (a GitHub source SHA or Vercel READY state alone is insufficient), fixture and migration version, protected backup/rollback/restore evidence, and database isolation proof.
- Actual effective money/provider/filing flags OFF; no real employee data, no external bank/provider calls, no real notifications. Record vault/upload flags separately for phases A, B and C rather than implying a QA-only flag change applied to production.
- Two fictional employer IDs with scoped roles, real desktop 1440px browser, an actual roughly 390px physical phone/OS/browser build, controlled mobile HTTPS route and observed current Manila pay cutoff. **October 1–15, 2026 is a historic format example, not a valid cutoff for a current-day October 17 punch.**
- Role/person mapping: Owner A+B; Payroll Officers A and B; different independent Checker; authorized HR and Manager; Employees A and B; independent QA/security witness for #853. Any additional A-5 approver/DBA/DPO roles are recorded separately. Do not have a payroll maker sign off as checker.
- Private encrypted evidence location and naming convention for actor/tenant/scenario, real UTC observation time, expected and actual behavior, protected screenshot/video/log/checksum reference, defect/retest ID, sign-off identity and exact served SHA. Do not paste URLs containing signed object tokens or credentials into GitHub.

Only after the above is inspected does the #853 facilitator initialize one fresh private v2 file:

```sh
node --test tests/issue-853-evidence-ledger.test.mjs
node scripts/qa/issue-853-evidence-ledger.mjs init /absolute/private/issue853.json
```

The 27 cases begin **NOT_RUN**; the three #853 money/filing/real-data fields begin **null / UNVERIFIED**, not false. After actual observations and independent review, the operator runs `node scripts/qa/issue-853-evidence-ledger.mjs check /absolute/private/issue853.json`. Even an entirely filled, internally valid ledger only returns `SELF_REPORTED_COMPLETE_REQUIRES_EXTERNAL_VERIFICATION`: it cannot authenticate a human and is not a GO vote.

## 3. #853 field journey — original 27 mandatory controls

Follow the exact expected-by-stage and persona binding in the [canonical 27-row runbook](issue-853-two-employer-operator-acceptance.md).

1. **Employer A, 9 separate human operations:** authorized Hire → Onboard → Schedule → current-date employee Clock In/Out → Manager Approve Time → A Payroll Officer Run Payroll → distinct Checker Review → Owner Release **Records Only** → A Payroll Officer Prepare **Draft Filing Evidence Only**.
2. **Employer B, the same 9 operations on its own worker/timecard/payroll:** B must have its *own* payroll officer and independently created/approved sources. Switching to B and reading an empty employee list is not nine stages.
3. **Nine independent cross controls:** `SWITCH_375`, `SWITCH_390`, `PAYROLL_A_DENIED_B`, `EMPLOYEE_A_DENIED_B`, `OWNER_AND_PAYROLL_SEPARATE`, `PAYOUTS_AND_FILING_OFF`, `RECOVER_INTERRUPTION`, `RESUME_AFTER_LOGIN`, `INDEPENDENT_HUMAN_NAVIGATION`. Capture the actual authorized/denied result and no stale cross-tenant response after refresh/retry.

Record any unsupported feature, access violation, missing separate checker, broken actual clock-in cutoff, wrong employer or duplicated record as **NEEDS_FIX/BLOCKED** with real private evidence. Do not promote synthetic API checks to human PASS. #691 fourteen physical WFM cases and #579 real-employer **no-money**, employee/component-centavo reconciliation are **separate** open gates and do not become accepted as part of the fictional journey.

## 4. #1146 Gate B — 16 hands-on vault checks, tracked separately

Use fictional HR/ESS accounts and only artificial PDF, PNG and JPEG bytes. For every numbered check below record `case, role, employer, servedSHA, fixtureVersion, device/browser, observedAtUtc, expected, actual, PASS|NEEDS_FIX|BLOCKED|NOT_RUN, privateEvidenceRef, defect/retest` in the QA-owned private vault. A checkbox or template alone is not an observation.

| Case | Perform and personally verify |
| --- | --- |
| 01 | HR on **1440px desktop** opens Worker 360; active document list contains the selected employee's files only. |
| 02 | Upload safe fictional PDFs as **all five selectable categories**: Government ID, Contract, Certificate, Onboarding paperwork, Other. Check the category, name, uploader, time and actual selected worker for each. |
| 03 | Upload decodable safe PNG and JPEG; check verified MIME, file size, category, uploader and timestamps. |
| 04 | Authorized HR opens a file through a scoped signed link; prove actual bytes and effective tenant/worker permissions. |
| 05 | Download the file, compare SHA-256 with the original fixture and verify the attachment filename. Do not store signed URLs in evidence. |
| 06 | Confirm the allowed deletion dialog, remove an **unlinked** file and prove absence from normal listing and refusal of the old *application* document URL. Separately check signed-URL TTL/expiry during provider Gate C; an already-minted short-lived object URL may not revoke instantly. |
| 07 | Try removing a document linked to COE/compliance/legal evidence: **must deny** and preserve audit/retention state. Do not fabricate a protected record by tampering with production data. |
| 08 | ESS linked employee reads own permitted file; direct colleague/foreign-worker ID requests return 403 or indistinguishable 404 without metadata. |
| 09 | Owner within current company is authorized; HR outside allowed org unit is denied, including crafted URL/API requests. |
| 10 | Unreviewed Manager and admin/payroll/checker/bookkeeper roles are denied where the authorization model requires. |
| 11 | Switch fictional A → B → A, refresh and try copied links/IDs; no file names, metadata or bytes cross tenants. |
| 12 | Malformed file, oversize, disallowed type, spoofed MIME, and pending/malware-uncleared object all **fail closed**; no executable content is served. |
| 13 | Attempt CSRF/cross-origin mutation, expired real session, unsigned direct download and guessed document IDs; no unauthorized read or write. |
| 14 | On an **actual physical phone around 390px**, repeat 01–06 with visible file row, reachable controls, usable touch targets, no horizontal overflow and operable confirmation dialog. Chromium viewport emulation is not a substitute. |
| 15 | In the isolated QA environment, independently turn both vault flags OFF; verify vault unavailable while existing HR/payroll/legacy-document flows still function. Restore the documented initial QA state, not production. |
| 16 | Retry a timed-out/upload/remove operation and duplicate clicks safely; inspect immutable audit, removed-object and retention behavior with no second file or orphaned accessible object. |

The existing [synthetic vault browser](../../scripts/employee-vault-profile-synthetic-browser.mjs) and [synthetic workflow](../../.github/workflows/employee-vault-profile-browser-acceptance.yml) are **engineering regression prerequisites only**. Even if five category paths pass on this PR, **all 16 manual cases stay NOT_RUN** until witnessed with primary private evidence. The previously seen Next.js `next dev` badge in synthetic screenshots must be diagnosed rather than hidden and a clean production-mode QA screenshot must be captured before visual sign-off.

## 5. #1146 Gate C / #928 — real-provider staging and recovery

Before *any* staging provider test, obtain named storage/DBA/security/DPO owners; record provider, region/residency and DPA, private bucket/IAM and KMS/SSE policy, key rotation, 60-second signature TTL, real malware scanner, versioning/legal hold/retention, backup/restore and a rollback and breach/erasure policy. **No provider access or written approval means BLOCKED/NOT_RUN, not PASS.**

On the approved isolated provider and fictional data, capture request/correlation IDs and private provider logs for each distinct acceptance probe:

1. Clean upload and real scan; authorized signed GET exactly matches bytes/hash, unsigned/cross-employer GET denies, expired/tampered signatures deny; real DELETE behavior and policy confirmed.
2. **PUT succeeds, SQL insert/audit/commit fails:** prove rollback, orphan intent/reconciliation, no accessible/untracked object and no leaked URL.
3. **Ambiguous timeout after remote PUT:** reproduce recovery or later reconciliation against real provider; demonstrate no stranded readable object.
4. **Remote DELETE fails after PUT/rollback:** prove the durable recovery ledger, retry outcome and privacy-safe audit receipt; do not claim cleanup succeeded if it did not.
5. **Concurrent duplicate COE approvals:** one authorized approved record and protected evidence only; no duplicated accessible object or audit gap.
6. Real scanner clean/threat/unavailable/malformed paths plus approved migration and rollback/restore verification. Signed views must fail closed on unscanned/pending content.

Attach real provider/DBA/DPO decisions privately and track the sanitized outcome against [#928](https://github.com/erwinmehehe/payrollph/issues/928). Local MinIO and stub scanner PASS do **not** qualify Gate C.

## 6. Closing decisions: separate source, UAT and rollout

| Decision | Required proof | Default |
| --- | --- | --- |
| #853 independently witnessed fictional journey | All **27/27** actual operator cases, exact served SHA/fixtures/role isolation, separate independent witness and signed private evidence | **NO-GO / 0 human PASS recorded** |
| #1146 hands-on vault | All **16/16** real desktop and physical-phone human cases with case-level private receipts; any exclusion explicitly approved | **NO-GO / NOT_RUN** |
| #928 real-provider storage/privacy | Real staging failure-mode tests, signed DBA/storage/DPO approvals, provider policy, legal hold/restore evidence | **NO-GO / NOT_APPROVED** |
| PayrollPH external pilot / production activation | Other independent WFM/payroll/security/migration gates (#691, #579, #744, #1015/#1061), exact deployment and explicit Owner GO | **NO-GO / no flags enabled** |

**Handoff rule:** record any actual defects and rerun them against the exact repaired *served* SHA. CI, static source reviews or this document must never update a human-observed status or authorize bank files, employee data processing, statutory filing, live payroll or production feature flag activation.

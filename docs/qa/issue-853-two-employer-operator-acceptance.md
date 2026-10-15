# Payroll PH — Issue #853: Two-employer acceptance

**Classification:** Development / fictional data only. **Actual independent human UAT: NOT RUN.** No real payroll, bank disbursement, company filing, live personal data, or external government submission is authorized by this guide.

This is a field-ready procedure for verifying the first-payroll customer experience with **two isolated fictional employers** and genuinely separate Owner, Payroll Officer, Checker and Employee sign-ins. Synthetic CI passing is a prerequisite, not a substitute for an actual person independently using the deployed development application.

## What success means

A fresh user can create or enter a fictional company and complete Hire → Onboard → Schedule → Clock In → Approve Time → Run Payroll → Review → Release **Payroll Records** → Prepare **Draft** Filing Evidence, without developer assistance, using only role-appropriate actions. A second fictional company can do the same without seeing or changing the first company's records. Negative security tests, mobile role switching and interruption recovery work. The reviewer can trace exact source/deployed SHA and privately verify screenshots, audit-event IDs and artifacts.

**Do not claim:** customer readiness, real-person independent UAT, fully validated tax computations, agency import acceptance, bank-file release, physical-device biometrics, or a production launch from synthetic automation alone.


## Automated evidence already available (not a two-company human trial)

The CI-connected nine-stage acceptance creates Employer A and a separate Employer B in disposable PostgreSQL. It runs the full fictional nine-stage path for **A only**, uses B to exercise cross-tenant denial, and checks 375 px/390 px employer switching and employee-session access.

The new `scripts/qa/issue-853-synthetic-coverage.mjs` runs after both connected and mobile automation and writes `qa-artifacts/issue-853-synthetic-two-tenant-scope.json`, which is safe to upload as a CI artifact. The scope validator fails if a required tenant denial, real authenticated employee access denial, stage, source SHA, or no-money invariant is absent. It **must** report `fullyAutomatedEmployerJourneys: 1`, `employerB.automatedStagesPassed: 0`, and `humanObservation.passed: 0`. This is not evidence that Employer B completed payroll or a person navigated either workflow.

The independent two-employer operator session follows the 27 separate rows in this guide. Record those rows privately; the CI artifact cannot be copied into the manual ledger as observed `PASS`.

## Safe test preparation

- Record the **exact Git commit SHA served by the development deployment**. The GitHub PR SHA and a Vercel `READY` status are not by themselves proof that the browser app is running that source. If you cannot verify the deployed SHA, classify the test as `BLOCKED`.
- Use an isolated development database seeded with **fictional data only**. Do not touch Neon production/default or paste secrets into GitHub. Never create an AWS account just for this.
- Confirm `XENDIT_PAYOUTS_ENABLED=false`, `PAYMONGO_DISBURSEMENTS_ENABLED=false` and other live transfer/release switches are OFF in the protected development environment. Verify agency submission integrations cannot transmit live data. If any money or filing operation is live, STOP.
- Use one Manila date range (suggested October 1–15, 2026) and identical source-traced setup for comparisons. Keep clocks, cutoff policy and statutory treatment explicitly recorded. Tax/government calculations still need later independent validation.
- Prepare six distinct fictional authenticated actor identities. Use the example fixture `fixtures/issue-853-fictional-tenants.json` only as non-secret labels; create protected test accounts through the supported app setup flows. No passwords or live IDs belong in that JSON.

| Actor | A membership | B membership | Purpose |
|---|---|---|---|
| Owner AB | Yes | Yes | Switch tenants and release records (never payouts) |
| Payroll Officer A | Yes | No | Calculate A payroll, denied B |
| Payroll Officer B | No | Yes | Calculate B payroll, denied A |
| Checker AB | Yes | Yes | Independently review; cannot be the payroll submitter |
| Employee A | Yes | No | Fictional punches and A-only employee view |
| Employee B | No | Yes | Fictional punches and B-only employee view |

An HR/Operations test role may be added if the app requires one. Keep every authorization boundary intact rather than granting administrators extra access to force a test to pass.

## Employer A and B journey — repeat every stage separately

| Stage | Operator action | Evidence to observe |
|---|---|---|
| **Hire** | Owner/authorized HR approves a fictional candidate or hiring request and creates employee record | One consistent worker ID; duplicate approval does not create another worker; tenant and actor recorded |
| **Onboard** | Finish fictional employee profile, legal entity and employment/payroll settings; log in as employee | Employee can see only their records; incomplete fields produce clear errors; no real government IDs |
| **Schedule** | Assign a fictional shift and pay period | Right tenant, employee, worksite and Manila time; schedule survives reload |
| **Clock In** | Use that fictional employee identity to punch in/out | Punch belongs to authorized worker and shift; no duplicate or cross-tenant assignment |
| **Approve Time** | Authorized manager resolves/approves attendance and captures audit event | Role enforcement, correct overtime/leave source and version; payroll officer cannot invent approved hours |
| **Run Payroll** | Tenant-specific Payroll Officer calculates draft payroll | Gross-to-net components displayed per worker, input lineage retained; **NO money transfer** |
| **Review** | Checker AB switches to the right tenant and reviews the draft | Checker identity distinct from payroll initiator; attempt to self-approve is denied; record expected-vs-actual |
| **Release Records** | Owner AB authorizes release of **payroll records** only | Payslip/register can be viewed; no bank transfer, wallet payout or live settlement request |
| **Filing Evidence** | Generate filing-preparation worksheets/draft files | Month/pay-period correspondence, export checksum, **no live submission** to government systems |

Complete A's nine stages, then B's nine stages with a **different payroll officer**. After every tenant switch, reload or request the same endpoint and ensure no stale data from the previous tenant appears. Use role-appropriate functions; the exact menu names may differ from the synthetic API flow.

## Cross-tenant and mobile controls

These nine checks are independently mandatory in addition to the 18 A/B journey checks:

- `SWITCH_375`: At 375 px, Owner AB switches A → B → A. Compare organization header, employee lists, payroll run IDs and async responses. B data must never appear while A is selected.
- `SWITCH_390`: Repeat at 390 px; check layout, clipped buttons, tap targets and restored selection.
- `PAYROLL_A_DENIED_B`: With an A-only payroll account, try a B payroll record directly by URL and API. A denial must be an authorization failure (403 or deliberately indistinguishable 404) with **no B payload**. Not a generic 500 or signed-out 401.
- `EMPLOYEE_A_DENIED_B`: An A-only employee must not read B's profile/payslip, including with copied IDs in a direct request.
- `OWNER_AND_PAYROLL_SEPARATE`: Owner and Payroll Officer must be distinct authenticated identities. A submitter cannot approve their own payroll where separation is required.
- `PAYOUTS_AND_FILING_OFF`: Show no bank-side payout and no actual government-file submission. Evidence can be disabled UI plus controlled non-production activity log; never send real money.
- `RECOVER_INTERRUPTION`: Interrupt an in-progress operation (network drop, safe API timeout or reload), reconnect, then confirm clear retry/resume and **no duplicate payroll or punch**.
- `RESUME_AFTER_LOGIN`: Sign out and sign back in as each user; stage completion and selected employer must be correct and unauthorized tenant state must not leak.
- `INDEPENDENT_HUMAN_NAVIGATION`: An actual reviewer unfamiliar with the setup attempts the full journey without a developer explaining the next button. Record elapsed time, confusing labels, blockers and full reviewer notes in a **private** evidence store.

**Screenshots alone are not conclusive.** Where possible, correlate protected request IDs and audit/event IDs with the observed UI and backend status. Do not copy secret tokens or person-level financial records into GitHub, screenshots shared to public services or this conversation.

## Running the local evidence ledger

The included Node 22 script is deliberately **not an application driver**. It creates a private blank evidence checklist and verifies completion evidence without touching the app, SQL, Neon or providers.

From a local Payroll PH checkout after copying in the files from this pack:

```powershell
New-Item -ItemType Directory -Force "$HOME\LinawPrivateQA" | Out-Null
node scripts/qa/issue-853-evidence-ledger.mjs init "$HOME\LinawPrivateQA\issue853.json"
```

The generated **v2** JSON starts with `flags.livePayouts`, `flags.governmentSubmission` and `flags.realEmployeeData` all **`null` (UNVERIFIED)**. Do not change these to `false` until an actual, independent human checks the **running application**; then record `safetyVerification.verifiedAtUtc`, `safetyVerification.verifierRef` and a private `safetyVerification.evidenceRef`. The verifier must not be one of the test operators. Any observation before that safety check is invalid. A previous v1 ledger is deliberately not silently promoted: archive it securely and start a new blank v2 ledger.

Open the JSON privately and record the exact *served* source/deployed SHA, credential-free HTTPS development URL, actual device/browser, six distinct pseudonymous fixture identities, and observed rows. Every `PASS` **or** `NEEDS_FIX` needs a real UTC `observedAtUtc`, a test-operator pseudonym, a **different independent human reviewer's** pseudonym, and a **unique** `private://`, `vault://` or encrypted `local://` evidence reference. A `PASS` must not have an unresolved defect or blocker. `NEEDS_FIX` requires an opaque `BUG-...` defect ID and the same observation evidence as a pass. `BLOCKED` requires `blockerCode` of `DEVICE`, `ENVIRONMENT`, `ROLE`, `DATA`, `REVIEWER` or `OTHER`, without falsely claiming an observation. Keep all observation fields empty for `NOT_RUN`. Do not change any canonical expected outcome to force a pass.

Provide a separate private `signoff` with a real UTC timestamp, independent reviewer alias and unique proof reference **after** the observations. The validator rejects stale/impossible/future observation times, mismatched SHA, duplicate proof references, self-review, premature signoff, and altered cases, but it cannot authenticate evidence or participants. Never use fabricated timestamps, fake witness aliases, salaries, identifying data, or raw employer exports.

```powershell
node scripts/qa/issue-853-evidence-ledger.mjs check "$HOME\LinawPrivateQA\issue853.json"
node --test tests/issue-853-evidence-ledger.test.mjs
```

`check` exits nonzero for missing checks, stale SHA, missing/duplicated personas, unverified runtime flags, missing private evidence, money/filing enabled, unapproved blocker reasons, mismatched reviewer or unrun tests. It does **not** print private evidence contents. Even when all operator claims are filled, its result is `SELF_REPORTED_COMPLETE_REQUIRES_EXTERNAL_VERIFICATION`—not a certification that a human actually witnessed the tests.

## Evidence and dispositions

Keep private evidence **outside the repository**. Track only sanitized references in GitHub issue #853, never raw employee rows, credentials, tax IDs, bank details or images revealing them.

A useful private evidence index has: reviewed source SHA, exact deployed SHA, UTC time, test role/pseudonym, tenant, stage ID, expected behavior, actual response/status, 375/390 screen or real device, private evidence reference, sanitized defect ID, independent reviewer pseudonym, and a dated human disposition. If the operator is also the only developer, label any completed tests **OWNER-OBSERVED DEV** and leave independently witnessed acceptance `NOT_RUN`.

**Fail/stop criteria:** wrong tenant access, duplicate payroll payment, real money/agency transmission, absence of usable error recovery, unauthorized payroll self-review, critical user journey failure or unverified deployed SHA. Do not override controls to force PASS.

## Status on preparation

This package contains a tested **blank** ledger. No real app/browser tests, independent signoffs or deployments were performed by generating it. The synthetic GitHub payroll journey from earlier PR #1010 is a separate engineering check. At acceptance start, all 27 human-observed rows are `NOT_RUN`. The original milestones #691 (WFM), #579 (real employer reconciliation), #907 (production recovery) and #1019 (pinned Drizzle second push) remain separate gates. This **27-row** two-employer ledger and the **19-row** independent witness manifest in `scripts/qa/independent-journey-853.mjs` are different evidence formats; they cannot be combined or automatically marked complete. Both remain unverified until the applicable human reviewers inspect primary private evidence. Production money movement and official filing remain **NO-GO**.

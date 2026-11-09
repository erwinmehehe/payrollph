> **Combined public classifications + existing account-email credit — DRAFT / NOT ACCEPTED:** 498 methods = 448 COVERED + 15 PUBLIC-BY-DESIGN + 35 GAP. Four owner-approved classifications create zero tenant-private method credits; the separate source-pinned account-email credit remains provisional. Exact-head CI and independent security/privacy review PENDING. No production activation.

> **Combined #1846 enterprise + #1862 account-email request proposals — PROVISIONAL / NOT ACCEPTED:** 498 methods = 448 COVERED + 11 PUBLIC-BY-DESIGN + 39 GAP; frozen subtotal 364 COVERED / 3 PUBLIC / 39 GAP. Two separate exact-source provisional POST method credits; independent security/identity review and final-head CI PENDING. No production activation.

> **PR #1846 proposed enterprise-admin POST credit on top of merged transfer proofs — PROVISIONAL / NOT ACCEPTED:** 498 methods = 447 COVERED + 11 PUBLIC-BY-DESIGN + 40 GAP; frozen subtotal 363 COVERED / 3 PUBLIC / 40 GAP. One source-pinned enterprise POST method, independent security/privacy review PENDING; do not infer tenant-wide acceptance or production activation.

> **PR #1853 multi-entity transfers credit on main with the security-write credits — PROVISIONAL / NOT ACCEPTED:** 498 methods = 446 COVERED + 11 PUBLIC-BY-DESIGN + 41 GAP; frozen 362 COVERED / 3 PUBLIC / 41 GAP. `POST` and `PATCH multi-entity/transfers` (WRK-03) are provisionally credited from the dedicated two-attacker real-HTTP PG16 proof (maker-checker, no provider, no money), merged proof #1853 (merge commit `073e23f01`, passing head `538c70b05`, [run 42480658953](https://github.com/erwinmehehe/payrollph/actions/runs/42480658953/job/128731654457)); it supersedes, and does not weaken, the earlier uncredited Playwright candidate hold. Independent security/payroll review PENDING. Production not authorized.

> **Security write recovery — SOLO_VERIFIED_DEV_RECOVERY:** 498 methods = 444 COVERED + 11 PUBLIC-BY-DESIGN + 43 GAP. Three complete methods, four real local PG16 HTTP cases; independent review PENDING; NOT ACCEPTED for production.

> **PR #1855 recovery + main billing credits — PROVISIONAL / NOT ACCEPTED:** 498 methods = 441 COVERED + 11 PUBLIC-BY-DESIGN + 46 GAP; frozen 357 COVERED / 3 PUBLIC / 46 GAP. Three distinct TOTP/scenario receipts and two separately proven billing POST methods; exact-head CI and independent security/financial review PENDING. Production not authorized.

> **Current combined PR #1826 billing + main year-end proposal — NOT ACCEPTED:** 498 methods = 438 COVERED + 11 PUBLIC-BY-DESIGN + 49 GAP; frozen 354 COVERED / 3 PUBLIC / 49 GAP. Prior year-end GET/POST and new subscription start/cancel POST receipts are distinct and provisional; fresh exact-head CI and independent security/payroll/billing review PENDING. No production acceptance.

> **Main baseline before this draft — SOLO_VERIFIED_DEV_RECOVERY:** 434 COVERED / 11 PUBLIC-BY-DESIGN / 53 GAP. Three methods from #1829 OFF-profile PG16 receipt; no production acceptance.

> **Earlier combined proposal (#1818 careers, #1817 audit atomicity, #1822 POS):** 430 COVERED / 11 PUBLIC-BY-DESIGN / 57 GAP; frozen 346 COVERED / 3 PUBLIC / 57 GAP. All source-linked credits provisional; security and production acceptance NOT GRANTED.

## 2026-11-08 PR #1826 subscription start/cancel tenant-isolation reconciliation — PROVISIONAL / NOT ACCEPTED

**Combined source-linked proposal: 438 COVERED + 11 PUBLIC-BY-DESIGN + 49 GAP among 498 methods; frozen 406 = 354 COVERED + 3 PUBLIC-BY-DESIGN + 49 GAP.** Exactly two additional provisional POST credits are from [merged PR #1804 fictional PostgreSQL 16 localhost proof 42254118161/128016607991](https://github.com/erwinmehehe/payrollph/actions/runs/42254118161/job/128016607991): POST /api/billing/subscription/start and POST /api/billing/subscription/cancel. Both signed-in own-employer positives, higher-ID real victim denials, unchanged foreign billing/payroll/audit state, idempotent retries and fail-closed fake Xendit transport are source pinned. Main's **separate** GET/POST year-end receipts remain intact and are **not** counted twice. New-head CI, independent billing/financial/security/privacy review and production-release approval remain PENDING. No real Xendit calls, charges, subscription changes, filings, payroll release or tenant-wide acceptance.

## 2026-11-07 Year-End GET/POST source-current ledger reconciliation — PROVISIONAL / NOT ACCEPTED

**This PR #1827 proposes only two new method credits:** `GET /api/year-end` and `POST /api/year-end`, each tied to merged #1804's [successful fictional PostgreSQL 16 real-HTTP run 42254117862/job 128016606342](https://github.com/erwinmehehe/payrollph/actions/runs/42254117862/job/128016606342) against the current route SHA `f040f5bbbc3df275d32d23f1728b1b0345f77814`. Five GET formats, two POST modes, owned actions, higher-ID victim denials, forged selectors, unchanged cross-employer SQL/audits and atomic payroll binding are backed by source pins. Old #1730 route proof is not reused. **Proposed branch ledger: 498 methods = 436 COVERED + 11 PUBLIC-BY-DESIGN + 51 GAP; frozen 406 = 352 COVERED + 3 PUBLIC-BY-DESIGN + 51 GAP.** The separately reviewed draft #1826 owns two *different* billing start/cancel POST method receipts, provisionally added in the combined ledger above; this **historical #1827 year-end-only proposal** never counted them. STA-01 has 25 provisionally COVERED methods and 2 unresolved method GAPs, so its batch remains INCOMPLETE. Nine other batches are also incomplete; DL-02 and WRK-01 have zero method GAPs but remain PROVISIONAL — NOT ACCEPTED. **Independent payroll/tax/security/privacy review and exact-final-head CI are required.** No real subscriptions, filings, payroll release, transfers, production deployment or tenant-wide isolation acceptance is authorized. All 17 page/action gaps remain.

## 2026-11-07 careers publication PATCH four-part method credit — PROVISIONAL / NOT ACCEPTED

**Proposed ledger: 498 methods = 426 COVERED + 11 PUBLIC-BY-DESIGN + 61 GAP; frozen 406 = 342 COVERED + 3 PUBLIC-BY-DESIGN + 61 GAP.** The source-linked frozen queue assigns this PATCH to PII-02, even though its dedicated proof workflow is named EDG-01. One and only one proposed method, `PATCH /api/careers/admin`, is backed by [passing production-mode localhost PG16 HTTP run 41798531116/job 126468332784](https://github.com/erwinmehehe/payrollph/actions/runs/41798531116/job/126468332784) at reviewed #1751 head `9d78cf39f82bc5f739e2927e19818b301ecaac56`. Two independently authenticated owners, third higher-ID victim with persisted requisition ID > 6, 3 own publishes / 2 own unpublishes, 20 denied requests, genuine audited DB transitions, victim/payroll immutability, and injected PostgreSQL audit failure rollback. Exact route, runner, workflow and security-critical inputs remain unchanged from that passing run; current-head package/build settings changed and **fresh final-head CI remains mandatory**. Independent security/HR/privacy review PENDING. The recruitment feature, production migration, providers and payroll remain OFF/UNAUTHORIZED. 17 pages/actions and 61 API GAPs remain NOT ACCEPTED; this is not a tenant-wide security certificate.

> **Prior POS + email ledger checkpoint:** 429 COVERED / 11 PUBLIC-BY-DESIGN / 58 GAP. Distinct source-pinned credits only; independent acceptance pending.
> **Current combined provisional email-verification + migrations POST ledger: 431 COVERED / 11 PUBLIC-BY-DESIGN / 56 GAP.** One distinct `POST /api/migrations` source-pinned PG16 real-HTTP method credit from [#1815's four-kind JSON/XLSX and audit-veto proof](https://github.com/erwinmehehe/payrollph/actions/runs/42326040103/job/128261441543) joins main's separate `POST /api/account/email/verify` credit from [#1805's token-authenticated proof](https://github.com/erwinmehehe/payrollph/actions/runs/42316473226/job/128230185900). Both remain provisional; 17 page/action GAPs, independent security review PENDING, and no production acceptance or release authority.
## 2026-11-07 migrations POST proof promotion (PROVISIONAL, NOT ACCEPTED)
The migration credit covers two independent fictional employers with eight JSON and eight XLSX owned commits, foreign/forged-denial and discrimination checks, immutable victim SQL/audit, and eight forced audit-insert failures fully rolled back. The earlier [#1805](https://github.com/erwinmehehe/payrollph/pull/1805) JSON-only candidate lacked independent XLSX/audit-veto coverage; it is superseded, not double-counted. This promotion changes no runtime endpoint, SQL migration or feature flag.
## 2026-11-06 PR #1766 reconciled with merged #1784 — PROVISIONAL, NOT ACCEPTED

**Current combined branch ledger: 498 methods = 431 COVERED + 11 PUBLIC-BY-DESIGN + 56 GAP; frozen 406 = 347 COVERED + 3 PUBLIC-BY-DESIGN + 56 GAP.** `PATCH /api/careers/admin` (PII-02) is provisionally credited from [fictional PG16 HTTP run 41798531116](https://github.com/erwinmehehe/payrollph/actions/runs/41798531116/job/126468332784), with independent security/HR/privacy review pending; `POST account/email/verify` (EDG-01) is provisionally credited from the independently executed two-attacker, one-use-token fictional PG16 proof merged by #1805 ([proof run 42316473226](https://github.com/erwinmehehe/payrollph/actions/runs/42316473226/job/128230185900)); independent security review PENDING. `POST payroll-runs/[id]/pilot-signoff` and `GET payroll-runs/[id]/xendit-payout` (MNY-01) are provisionally credited from the dedicated two-attacker payroll-run-actions harness (no payout provider configured or called), merged proof #1803 (merge commit `79da483ee`, passing head `02cfd9445`, [run 42253150229](https://github.com/erwinmehehe/payrollph/actions/runs/42253150229/job/128013254082)); `exports` POST and `xendit-payout` POST stay GAP; independent review PENDING. `POST payroll-runs/[id]/payout-reconciliation` (MNY-01) is provisionally credited from the existing real-HTTP PG16 PayMongo isolation harness against a **loopback-only synthetic PayMongo** (no real provider contacted, no real payout), main-head [run 42229558806](https://github.com/erwinmehehe/payrollph/actions/runs/42229558806/job/127931638957) on `9c9f0ad78`; the earlier provider-disabled 501 hold is superseded, not weakened. Independent review PENDING. `POST auth/logout` (EDG-01) is provisionally credited from its dedicated two-attacker harness, merged proof #1795 (merge commit `b18244790`, passing head `b32c2286e`, [run 42203481558](https://github.com/erwinmehehe/payrollph/actions/runs/42203481558/job/127844239303)); independent review PENDING. `POST account/password` (EDG-01) is provisionally credited from its dedicated two-attacker harness, merged proof #1794 (merge commit `1d475f4e7`, passing head `374fe6d50`, [run 42183409095](https://github.com/erwinmehehe/payrollph/actions/runs/42183409095/job/127778007531)); independent review PENDING. Retains separate provisional staffing-policy GET, payroll submit-review/release POST, and MWE decision PATCH evidence. Exact integrated-head CI and independent security/payroll-tax review are pending. No production deployment, payroll release, payout, or tenant-wide acceptance.
## 2026-11-06 PR #1766 reconciled with merged #1784 — PROVISIONAL, NOT ACCEPTED

**Current combined branch ledger: 498 methods = 433 COVERED + 11 PUBLIC-BY-DESIGN + 54 GAP; frozen 406 = 349 COVERED + 3 PUBLIC-BY-DESIGN + 54 GAP.** `PATCH /api/careers/admin` (PII-02) is provisionally credited from [fictional PG16 HTTP run 41798531116](https://github.com/erwinmehehe/payrollph/actions/runs/41798531116/job/126468332784), with independent security/HR/privacy review pending; `POST account/email/verify` (EDG-01) is provisionally credited from the independently executed two-attacker, one-use-token fictional PG16 proof merged by #1805 ([proof run 42316473226](https://github.com/erwinmehehe/payrollph/actions/runs/42316473226/job/128230185900)); independent security review PENDING. `POST payroll-runs/[id]/pilot-signoff` and `GET payroll-runs/[id]/xendit-payout` (MNY-01) are provisionally credited from the dedicated two-attacker payroll-run-actions harness (no payout provider configured or called), merged proof #1803 (merge commit `79da483ee`, passing head `02cfd9445`, [run 42253150229](https://github.com/erwinmehehe/payrollph/actions/runs/42253150229/job/128013254082)); `exports` POST and `xendit-payout` POST stay GAP; independent review PENDING. `POST payroll-runs/[id]/payout-reconciliation` (MNY-01) is provisionally credited from the existing real-HTTP PG16 PayMongo isolation harness against a **loopback-only synthetic PayMongo** (no real provider contacted, no real payout), main-head [run 42229558806](https://github.com/erwinmehehe/payrollph/actions/runs/42229558806/job/127931638957) on `9c9f0ad78`; the earlier provider-disabled 501 hold is superseded, not weakened. Independent review PENDING. `POST auth/logout` (EDG-01) is provisionally credited from its dedicated two-attacker harness, merged proof #1795 (merge commit `b18244790`, passing head `b32c2286e`, [run 42203481558](https://github.com/erwinmehehe/payrollph/actions/runs/42203481558/job/127844239303)); independent review PENDING. `POST account/password` (EDG-01) is provisionally credited from its dedicated two-attacker harness, merged proof #1794 (merge commit `1d475f4e7`, passing head `374fe6d50`, [run 42183409095](https://github.com/erwinmehehe/payrollph/actions/runs/42183409095/job/127778007531)); independent review PENDING. Retains separate provisional staffing-policy GET, payroll submit-review/release POST, and MWE decision PATCH evidence. Exact integrated-head CI and independent security/payroll-tax review are pending. No production deployment, payroll release, payout, or tenant-wide acceptance.

## 2026-11-06 PR #1784 synchronized with main — PROVISIONAL, NOT ACCEPTED

**Current combined branch ledger: 498 methods = 414 COVERED + 11 PUBLIC-BY-DESIGN + 73 GAP; frozen 406 = 330 COVERED + 3 PUBLIC-BY-DESIGN + 73 GAP.** Keeps the separately evidenced staffing GET and two payroll submit-review/release methods. All remain provisional pending exact-head CI and independent security/payroll review; no real payroll release or production activation.

# Tenant isolation closure plan — 498 API methods and 21 page/action surfaces

## 2026-11-05 #1761 integrated with merged #1760 — PROVISIONAL, NOT ACCEPTED

**Current combined ledger: 498 methods = 414 COVERED + 11 PUBLIC-BY-DESIGN + 73 GAP; frozen 406 = 330 COVERED + 3 PUBLIC-BY-DESIGN + 73 GAP.** Preserves #1760's three source-pinned fictional-PG16 method receipts, merged #1776's Resend webhook POST proof, and adds the disjoint staffing-policy GET candidate with separate manage/approved-mode #1637 receipts. Main's separate Xendit subscriptions webhook POST credit is retained under its documented retry-refusal evidence rule. Transfer POST/PATCH and source-revoked year-end GET/POST stay GAP with zero coverage credit, as do 17 scoped pages/actions. Source-only changes do not grant independent security review, tenant-wide acceptance, production approval, provider access, money movement, payroll release, or deployment.

## 2026-11-04 #1760 CURRENT PROVISIONAL COVERAGE PROPOSAL — NOT ACCEPTED

**Current ledger: 498 methods = 414 COVERED + 11 PUBLIC-BY-DESIGN + 73 GAP.** Reconciled with main@a40ed20d907c, including merged #1762/#1763/#1764/#1765. Exactly three *provisional* method credits are separately backed by #1762's passing exact-source fictional-PG16 HTTP jobs. One further provisional credit, `POST webhooks/resend`, is backed by merged proof #1763 ([passing disposable-PG16 run 41829420219](https://github.com/erwinmehehe/payrollph/actions/runs/41829420219/job/126572429402), head `5e1aeba10`) under `proofPolicy.providerCallback`; independent review PENDING. A second, `POST webhooks/xendit/subscriptions`, is backed by merged proof refresh #1777 ([passing disposable-PG16 run 41979854009](https://github.com/erwinmehehe/payrollph/actions/runs/41979854009/job/127087199194), head `c7fda4413`) under `proofPolicy.providerCallback` and its bounded `documentedRetryRefusal` exception (the route's deliberate retry 503 counts only as foreign-denial evidence, with byte-identical bodies and unchanged snapshots); independent review PENDING. Two year-end GET/POST source revocations and transfer POST/PATCH remain **GAP / testedBy:null**. `POST payroll-runs/[id]/submit-review` and `POST payroll-runs/[id]/release` (MNY-01) are provisionally credited from the existing two-attacker money-lifecycle journey, receipt [run 42063867383](https://github.com/erwinmehehe/payrollph/actions/runs/42063867383) on main head `53ae6fa31` (both exact-approval-link legs); independent review PENDING. Frozen 406 methods: **330 COVERED + 3 PUBLIC-BY-DESIGN + 73 GAP**; 17 page/action GAPs. This is NOT tenant-wide or independent acceptance, and authorizes no production, payroll, money, payout, provider or deployment action.

## Current method-specific evidence and held transfers

## 2026-11-04 source-identical final-head PG16 proof recovery after #1762 — SOLO_VERIFIED_DEV_RECOVERY / DRAFT / NOT ACCEPTED

**Source-matched PG16 proof base:** `main@db7a943edd71`, #1762 exact proof-head `8b915bc17574b`; **498 API methods = 411 COVERED + 11 PUBLIC-BY-DESIGN + 76 GAP**; frozen 406 = **327 COVERED + 3 PUBLIC-BY-DESIGN + 76 GAP**. This is three distinct provisional credits above integrated main's 405/11/82, not a claim of global security acceptance. Both year-end source-revoked methods and both transfer write methods stay GAP, and 17 page/action GAPs remain.

| Exact API method | Credit | Exact final-head fictional-PG16 real-HTTP evidence and reason |
|---|---|---|
| `POST /api/multi-entity/transfers` | **YES (provisional), superseded by the dedicated #1853 proof** — see the top ledger entry; the earlier #1711/#1762 text below is historical and was about the uncredited Playwright candidate | [#1711 source-matched passing job 41407277583/125152053135](https://github.com/erwinmehehe/payrollph/actions/runs/41407277583/job/125152053135), final head `30f5319fe210d226009ab974eb937521ce9530ee`, current route SHA `a4ac9ec92df17492c4c0918f08114660bc4c6ebe`. The older #1662 SHA differs and was **re-pinned to #1711 for review, not for credit**. **Missing:** a complete independently owned B/C positive and real victim transfer ID strictly higher than both own comparator transfers. |
| `PATCH /api/multi-entity/transfers` | **YES (provisional), superseded by the dedicated #1853 proof** — see the top ledger entry; the earlier #1711/#1762 text below is historical and was about the uncredited Playwright candidate | Same exact-head #1711 source-matched green job. Reject/approve/apply decisions were exercised under one organization's checker only; seeded victim request precedes own comparator transfers. **Missing:** the complete independent B/C positive plus ordered higher-ID victim method contract. |
| `PATCH /api/self/profile` | **YES, provisional** | [#1762 PG16 final-head proof job 41830570387/126576391067](https://github.com/erwinmehehe/payrollph/actions/runs/41830570387/job/126576391067), head `8b915bc17574b87ff707258bff827265866bbaea`, unchanged route blob `41d26b23678e8822aff4701a611c429e97f659c3`. Two actual signed-in own writes, genuine high-ID victim, forged selectors bound to own identity, unchanged victim/payroll/audit and rollback. [Source line 193](../../scripts/qa/tenant-self-profile-atomic-http.mjs#L193). |
| `POST /api/hcm/salary-corrections/preview` | **YES, provisional** | [#1762 PG16 final-head proof job 41830569945/126576389367](https://github.com/erwinmehehe/payrollph/actions/runs/41830569945/job/126576389367), head `8b915bc17574b87ff707258bff827265866bbaea`, unchanged route blob `8abc2b8059a403b81bf24c78108445651be4690a`. Two independent revision-backed own 200s, high-ID victim and forged selector denials, exact 18 real denied HTTP calls and unchanged SQL. [Source line 204](../../scripts/qa/tenant-hcm-salary-correction-preview-http.mjs#L204). |
| `POST /api/invitations` | **YES, provisional** | [#1762 PG16 final-head proof job 41830569741/126576388593](https://github.com/erwinmehehe/payrollph/actions/runs/41830569741/job/126576388593), head `8b915bc17574b87ff707258bff827265866bbaea`, unchanged route blob `59bdded07a33d7c4dbc394a84135ce99f9f04042`. Complete `methodFullyCovered:true` real HTTP run: two own 201s, seven invited roles, independent company-admin own success, victim/unit/forged denials, revoked owner 403, local SMTP only, unchanged victim SQL. [Source line 298](../../scripts/qa/tenant-invitations-post-boundary.mjs#L298). |

The three credited exact route, runner, contract and workflow Git blob SHAs now match the updated **#1762 exact source final proof head**, validated by successful throwaway PG16 real-HTTP jobs; no stale #1738/#1739/#1746 runner pins are retained. The new ledger head still needs its own CI / source guard / `tenant-manifest-repin.mjs --base origin/main` and owner review before any later merge decision. **Only `@erwinmehehe` is owner/reviewer**; evidence label `SOLO_VERIFIED_DEV_RECOVERY` does not assert independent security acceptance. All production/Neon SQL, real users, payroll, payout, payment, provider, remote email and CSP activation remain forbidden/OFF.


## 2026-11-04 #1764 static API v1 public catalog — DRAFT / NOT ACCEPTED

**Current proposed ledger: 498 methods = 405 COVERED + 11 PUBLIC-BY-DESIGN + 82 GAP; frozen 406 = 321 COVERED + 3 PUBLIC-BY-DESIGN + 82 GAP.** The unchanged `GET /api/v1` returns public documentation, not employer data, and is reclassified PUBLIC-BY-DESIGN only. An earlier-head disposable PG16/localhost HTTP equality and unchanged-DB proof passed; the synced head requires fresh CI and independent security review. No tenant-scoped method credits, no frozen-batch or global acceptance. 17 page/action GAPs remain. No customer data, provider connectivity, money or production activation.

## 2026-11-04 #1744 after #1749 main — REVIEWED SOURCE SUPERSESSION, NOT ACCEPTED

**Current draft ledger: 498 methods = 405 COVERED + 10 PUBLIC-BY-DESIGN + 83 GAP; frozen 406 = 321 COVERED + 2 PUBLIC-BY-DESIGN + 83 GAP.** Preserve the #1749 source-pinned payout PATCH and the two unchanged year-end/prior-evidence method receipts. The original #1730 `year-end` GET/POST receipts belong to old handler blob 7572c611 and cannot automatically qualify the revised atomic-binding route e4741d98. Exactly those two provisional method credits are now explicitly **GAP, zero credits**, with an exact-source, all-or-nothing revocation guard. Dedicated fictional PG16 audit/queue fault and race checks passed on *previous* head 9a6760b, not yet on this integration head. Require new exact-head CI, method-level proof, independent payroll/security review before changing GAP or merging. All 17 page/action GAPs remain. No production/payroll money, filing, provider, payout or feature activation.

## 2026-11-04 source-current WFM staffing-policy GET recovery — DRAFT / NOT ACCEPTED

**Single provisional API method: 498 methods = 406 COVERED + 11 PUBLIC-BY-DESIGN + 81 GAP; frozen 406 = 322 COVERED + 3 PUBLIC-BY-DESIGN + 81 GAP.** Historical #1637 final head `2e14551d2ea88b72fb53d62da3682f87f8ea521a` ran two source-identical, successful fictional PG16 jobs: [populated manage, foreign victim, custom permission and revocation](https://github.com/erwinmehehe/payrollph/actions/runs/41164870341/job/124430238281) and [populated approved mode with verified approval receipt](https://github.com/erwinmehehe/payrollph/actions/runs/41164870305/job/124430150239). Exact route blob `e0ea8e23ffad6ca72edd5ef8da4dbe3a332d041c` is unchanged. The historical jobs emitted zero credits; this separate method-specific candidate now proposes one sole-owner provisional credit, not independent or production acceptance. Exact new PR-head CI, owner source/receipt review and serial reconciliation with #1760 remain pending. No payroll, payout, provider, SQL, migration, flag or deployment changes.


## 2026-11-04 PR #1762 five-method exact-final-head PG16 source recovery — DRAFT / ZERO NEW CREDITS

**Historical pre-#1744 baseline `origin/main@c2876177bce3278a34ec2323031d2102b6d80330`: 498 methods = 407 COVERED + 10 PUBLIC-BY-DESIGN + 81 GAP. Latest main revokes two old-source year-end credits, so the current ledger is 405 COVERED + 10 PUBLIC-BY-DESIGN + 83 GAP, with frozen 406-method queue 321 COVERED + 2 PUBLIC-BY-DESIGN + 83 GAP and 17 separate page/action GAPs.** New source-bound real-HTTP PG16 proof candidates cover transfers POST/PATCH (independent A/C own positives, genuine ordered victim transfer), atomic self-profile PATCH (and merged #1523's explicit no-credit note), salary-preview POST, and full-role invitations POST (real >6 victim invitation and revoked owner). **No coverage status is promoted before a passing exact-final-head job and repin.** See [method-by-method recovery ledger](../qa/tenant-five-method-final-head-recovery-20261104.md). Evidence category `SOLO_VERIFIED_DEV_RECOVERY`, repository owner @erwinmehehe sole reviewer; not independent production acceptance. No real payroll/production data/Neon, money, payout, provider, scheduler, CSP or deployment.


## 2026-11-04 #1749 reconciled on main@150dcd7e4b66 — DRAFT, NOT ACCEPTED

**Provisional source-pinned ledger: 498 methods = 407 COVERED + 10 PUBLIC-BY-DESIGN + 81 GAP; frozen 406-method queue = 323 COVERED + 2 PUBLIC-BY-DESIGN + 81 GAP.** All four #1730 year-end/prior-evidence methods and prior source-pinned receipts remain unchanged. The only new provisional method is `PATCH /api/payout-profiles` with a historic exact-source PG16 proof. Independent security review and owner acceptance remain PENDING. No money/provider activation, production release or tenant-wide certification; 17 page/action GAPs remain.

## 2026-11-03 #1730 reconciled after merged #1728 — DRAFT / NOT ACCEPTED

**Combined provisional ledger: 498 methods = 406 COVERED + 10 PUBLIC-BY-DESIGN + 82 GAP.** Frozen 406-method subtotal = **322 COVERED + 2 PUBLIC-BY-DESIGN + 82 GAP**. This branch retains all three distinct #1728 STA-01 compliance POST credits (25 COVERED / 2 GAP in STA-01), and separately carries four exact-source #1730 year-end/prior-evidence method credits (DL-01: 22 COVERED / 2 PUBLIC / 2 GAP; MNY-01: 26 COVERED / 7 GAP). All 17 page/action gaps remain. No tenant-wide acceptance or live financial, BIR, payroll, provider, payout, SQL, CSP or feature activation is authorized. New exact-head CI, security and real localhost synthetic PG16 proofs are mandatory before source merge.

## 2026-11-03 #1728 integrated with merged #1712 — SOURCE MERGE CANDIDATE, NOT ACCEPTED

**Current integrated proposal: 498 methods = 400 COVERED + 10 PUBLIC-BY-DESIGN + 88 GAP; frozen 406 queue = 316 COVERED + 2 PUBLIC-BY-DESIGN + 88 GAP.** Preserves #1712's two WRK-01 credits and adds only three disjoint STA-01 compliance POST method proofs from #1728. WRK-01 frozen = 32 COVERED / 7 GAP; STA-01 frozen = 25 COVERED / 2 GAP. All 17 page/action GAPs remain. Existing source/PG16 receipts are retained; updated integration-head CI, security HTTP, isolated PostgreSQL and owner review must pass before merge. Not independent tenant-wide or production acceptance; no live SQL, provider, payout or feature activation.

## 2026-11-03 PR #1712 after merged #1727 — MERGED / GLOBAL ISOLATION NOT ACCEPTED

**Proposed integrated ledger: 498 methods = 397 COVERED + 10 PUBLIC-BY-DESIGN + 91 GAP; frozen 406 queue = 313 COVERED + 2 PUBLIC-BY-DESIGN + 91 GAP.** Main already includes six distinct #1727 credits and newer #1736 source-matched `POST leave` and `POST governed-handoffs` proofs, with no duplicate credits. #1712 adds only `POST workforce/roster-rules/preview` ([PG16 receipt 41293308290](https://github.com/erwinmehehe/payrollph/actions/runs/41293308290)) and `GET workforce/greedy-roster` ([PG16 eligible-worker receipt 41447125405](https://github.com/erwinmehehe/payrollph/actions/runs/41447125405)); unchanged source, proof and workflow identities are pinned. `GET workforce/demand-staffing/policies` remains GAP due to unproved manage mode. Evidence is sole-owner `SOLO_VERIFIED_DEV_RECOVERY`, not independent review; all 17 page/action GAPs remain, and final integrated-head CI and owner merge decision are required. No production/Neon SQL, payroll, provider, payout, CSP, worker activation or deployment.

> **NOT ACCEPTED — baseline only.** Audited GitHub `main@28e1224448342c34a4899fb67660b3da504530c1` on 2026-10-21: 289 route files, 490 HTTP methods, **76 COVERED / 8 PUBLIC-BY-DESIGN / 406 GAP**, plus **20 page/action GAPs**. No additional methods are certified by writing this plan. This document is a **frozen 406-method closure queue**; later PRs must update the live manifest and the inventory headline independently. Manifest acceptance stays **NOT ACCEPTED**; an independent owner/reviewer decides acceptance.

## 2026-11-03 #1728 compliance POST source-pinned integration — SOLO_VERIFIED_DEV_RECOVERY (NOT ACCEPTED)

**Current proposed combined ledger: 498 methods = 398 COVERED + 10 PUBLIC-BY-DESIGN + 90 GAP.** From current main's 395/10/93, three method-specific POSTs were GAP on main and gain provisional owner-only evidence: `POST compliance/contribution-issues`, `POST compliance/payroll-month-close`, and `POST compliance/statutory-remittances`. Original source-pinned fictional PostgreSQL 16 localhost four-part run [41446327305](https://github.com/erwinmehehe/payrollph/actions/runs/41446327305) passed on original proof head `d3cdcf020a559ae85c813d656620832dd0a46d4e`. The branch's previously reviewed contribution referral event correction is preserved exactly with its existing source reconstruction guard, not reauthored. Main's #1727, #1736 and other more recent receipts remain untouched. The new combined merge head must pass its own exact-head CI, audit and tenant proofs before merge.

**Scope and hold:** All three are labelled **SOLO_VERIFIED_DEV_RECOVERY**, not independent approval. No double-counting, tenant-wide acceptance, production SQL, Neon, live workers, official statutory remittance, money, payout, provider, CSP activation or deployment. **17 page/action GAPs remain.**

## 2026-11-03 PR #1727 main integration — DRAFT, NOT ACCEPTED

Current live proposed ledger **498 methods = 395 COVERED + 10 PUBLIC-BY-DESIGN + 93 GAP**. Six newly promoted disjoint POST methods: `POST leave/conversion`, `POST payroll/overpayment-preflight`, `POST outbox`, `POST treasury-controls`, `POST compliance/labor-inspection`, `POST earned-wage`. Two additional originally proposed methods, `POST leave` and `POST governed-handoffs`, were **dropped as new credits**: both are already covered on main by the newer #1736 source-matched proof [41452144006](https://github.com/erwinmehehe/payrollph/actions/runs/41452144006), not #1727's older #1735 receipt. Main's updated governed-handoff audit atomicity, proof pins and SQL safety guards are preserved. The six retained historical PG16/HTTP receipts had exact route/proof/workflow blobs matching current main; the new combined integration head still requires CI. Evidence labelled **SOLO_VERIFIED_DEV_RECOVERY** only, never independent security acceptance. Frozen 406-method subset: **311 COVERED + 2 PUBLIC-BY-DESIGN + 93 GAP**; page/action 4 covered provisionally, 17 gaps. No production SQL, Neon, API route changes, payment, payout, provider, CSP, real data, feature rollout or deployment.

## 2026-11-02 merged-proof four-part re-audit on main@11b6d544 — ZERO CREDITS / NOT ACCEPTED

The original review used `main@11b6d544cf6bd30c84fc524a088f90627dec09e6`; this draft now integrates **`main@9fb1ddd79a7517085097dae4d0e66e2552efc0f9`** with zero new credits and checked all then-open PR ownership, with prior promotion precedents [#1469](https://github.com/erwinmehehe/payrollph/pull/1469), [#1509](https://github.com/erwinmehehe/payrollph/pull/1509), [#1519](https://github.com/erwinmehehe/payrollph/pull/1519) and [#1523](https://github.com/erwinmehehe/payrollph/pull/1523). The six methods below have **0 promotions**. Detailed final-head CI receipts and source-line citations: [six-method review ledger](../qa/tenant-six-method-proof-review-2026-11-02.md).

| Method | Merged evidence | State | Missing part of the contract |
|---|---|---|---|
| `POST bir/annual-employer/candidate` | [#1676 final head](https://github.com/erwinmehehe/payrollph/commit/abe1600a2df31f513cda152bed828fd5567fd72e) | **GAP** | Only `mode=template` is proven. Complete `check` and `download` own-success, victim denial, forged selector and unchanged-victim-DB branches absent. Numeric victim ID **>6** also unproven. |
| `POST leave/conversion` | [#1675 final head](https://github.com/erwinmehehe/payrollph/commit/b16f4adfdf6c6dc14813360045bb8f0efaf10892) | **SKIPPED (baseline GAP; #1727 claims credit)** | Do not change this method here: concurrent draft [#1727](https://github.com/erwinmehehe/payrollph/pull/1727) already proposes its provisional credit. Independent ID >6 contract issue belongs to that review. |
| `POST payroll/overpayment-preflight` | [#1674 final head](https://github.com/erwinmehehe/payrollph/commit/ec0e8b081c52bb8b22b7911c886c2005e45312f2) | **SKIPPED (baseline GAP; #1727 claims credit)** | Do not change this method here: concurrent draft [#1727](https://github.com/erwinmehehe/payrollph/pull/1727) already proposes its provisional credit. Independent ID >6 contract issue belongs to that review. |
| `POST multi-entity/transfers` | [#1662 final head](https://github.com/erwinmehehe/payrollph/commit/c7001c59b9f60b55192bfb1d1876a18e0f18f482) | **GAP** | No two independently successful own-employer POSTs; real victim transfer ID ordering not proven. |
| `PATCH multi-entity/transfers` | [#1662 final head](https://github.com/erwinmehehe/payrollph/commit/c7001c59b9f60b55192bfb1d1876a18e0f18f482) | **GAP** | Reject/approve/apply are all under one employer's checker; no independent positive second employer or victim transfer ID ordering. |
| `PATCH compliance/filing-validations/[id]` | [#1501 final head](https://github.com/erwinmehehe/payrollph/commit/893977583b4ac7e4d49da5b03327f7bc5c8e4a53) | **GAP** | Rejection-only positive; successful accepted-outcome branch missing. Current route source was subsequently hardened, so older receipt cannot prove the full current handler. |

**Historical review totals before the latest main synchronization:** 295 routes and **498 API methods = 387 COVERED + 10 PUBLIC-BY-DESIGN + 101 GAP**; pages/actions **4 provisionally covered / 17 GAP**. Frozen subtotal **303 COVERED + 2 PUBLIC-BY-DESIGN + 101 GAP = 406**; no historical accepted receipt has been repinned to claim a new method. Merged [#1711](https://github.com/erwinmehehe/payrollph/pull/1711) changed transfer POST/PATCH source and proof but claimed zero coverage credit. Concurrent open [#1727](https://github.com/erwinmehehe/payrollph/pull/1727) proposes credit for leave/conversion POST and overpayment-preflight POST. **Both were skipped in this branch and left byte-identical to main in the manifest and inventory.** No other open PR credits the four reviewed GAP identities; [#1728](https://github.com/erwinmehehe/payrollph/pull/1728) covers unrelated compliance POSTs with zero credit. Preserve all provider/payout/money/CSP gates **OFF** and independent review **PENDING**. No production SQL, Neon, secrets or real customer data.

## 2026-11-02 PR #1731 issued-demand recovery — SOLO_VERIFIED_DEV_RECOVERY

Historical pre-#1728 PR #1731 inventory (DRAFT / NOT ACCEPTED): 498 methods = 397 COVERED + 10 PUBLIC-BY-DESIGN + 91 GAP. This is a proposed, source-pinned method-level ledger, not merged main, independent human acceptance or authorization to deploy.

**Historical method-only evidence ledger (at its earlier base):** 498 API methods = **397 COVERED + 10 PUBLIC-BY-DESIGN + 91 GAP**, with 17 separate page/action gaps. Compared to main's 387/10/101, two disjoint methods are added: `POST /api/workforce/demand-observations/issued` and `POST /api/workforce/demand-observations/issued/score`. Neither is duplicated by open #1727 or by the historical issued GET proof.

**Exact PG16 real-HTTP four-part evidence:** [run 41444835667 / job 125275257980](https://github.com/erwinmehehe/payrollph/actions/runs/41444835667/job/125275257980), PR-head `1834b73aab8e162e19b4b260e51b32e6fa1fbbec`, source/proof/workflow blobs pinned in each manifest method. Both independently signed-in attacker employers produce actual owned 201s and subsequent 200 replays, the real higher-ID victim is denied 403 with victim worksite/issue and foreign source forgery explicitly refused, and real victim/source/payroll/audit SQL remains unchanged on every refused call. All four parts are asserted before the receipt. This is `SOLO_VERIFIED_DEV_RECOVERY`: `@erwinmehehe` is the repository's **only owner/reviewer**, not a second independent reviewer. Full PR CI on the ledger-changing head must still pass before merge, and the overall tenant and production release acceptance remains **NOT ACCEPTED**. No live data, financial provider, POS, payroll, payout or deploy.

## 2026-10-31 PR #1646 sync with main@04029a8b — NOT ACCEPTED

**Proposed combined inventory: 498 methods = 383 COVERED + 10 PUBLIC-BY-DESIGN + 105 GAP.** `main@04029a8b6eb9f273f5755f882efc02bb1e9ae5b0` contributes 382 already source-pinned methods. This branch adds **only POST /api/compensation** with its five creation variants (`component`, `cycle`, `band`, `component_assignment`, `proposal`) and real own/employer-foreign PostgreSQL 16 evidence. Its existing `PATCH /api/compensation` proof remains separately credited; this PR updates only its shifted family row reference (46 to 49) without a second credit. The 27 newer main commits, including separate workforce-planning proof and global worker authorization changes, are preserved. **All 17 page/action gaps and remaining 105 method gaps remain unaccepted.** Fresh exact-head PG16/CI and human tenant/compensation/maintainer review are required. No live payroll, provider, filing or production release is authorized.

## 2026-11-02 PR #1736 workflow write SOLO_VERIFIED_DEV_RECOVERY (DRAFT)

**Current proposed ledger: 498 methods = 389 COVERED + 10 PUBLIC-BY-DESIGN + 99 GAP.** `POST leave` and `POST governed-handoffs` have exact-current-source/runner/workflow pinned four-part evidence from [fictional PG16 localhost run 41452144006](https://github.com/erwinmehehe/payrollph/actions/runs/41452144006), passed on head `49360001aa6ca2911f1e99617ba3ad34d82a6a67`. Both independently signed-in fictional attacker employers performed successful own leave create/revise and governed separation/roster plus replay, changed-source follow-up and audit-trigger rollback; authentic higher-ID victim employee/leave/separation/claim IDs denied, forged selectors rejected and before/after payroll, leave, approvals, audit and outbox SQL unchanged after denied requests. Governed-handoffs' transactional source repair (route hash `258ec66f80e24e4d7ac484fb4be789573b1a9820`) is specifically retained. Sole reviewer is `@erwinmehehe`. Evidence label **SOLO_VERIFIED_DEV_RECOVERY**, not independent review. The same method identities appear in existing draft [#1727](https://github.com/erwinmehehe/payrollph/pull/1727) with **older merged #1735 source hashes**: these are *alternative candidate branches*, never add both sets of credits into a combined manifest; if later integrated, preserve only latest exact matching source/proof receipt and count each method once. No production database, Neon, provider, money, payout, CSP enablement, deployment or merge. Keep draft.

## 2026-11-02 PR #1730 year-end four-part SOLO_VERIFIED_DEV_RECOVERY (DRAFT)

**Historical pre-#1728 queue reconciliation: 498 methods = 401 COVERED + 10 PUBLIC-BY-DESIGN + 87 GAP**. This includes the two already merged #1712 Workforce credits and the four provisional year-end methods on this branch; none is counted twice. Exact-final-head broad CI and maintainer review remain pending. The historical 406-method queue retains its original membership and does not authorize deployment.

**Historical #1730 source-pinned ledger: 498 API methods = 401 COVERED / 10 PUBLIC-BY-DESIGN / 87 GAP**; 17 scoped page/action GAPs remain. Both `GET/POST year-end` and `GET/POST year-end/prior-evidence` passed method-specific real-HTTP tests on exact PR head `066c1d6b405365ff9ddacc229b8d0ce5cbc68aa5`, with two independent signed-in fictional attacker employers, a real higher-ID victim, legitimate source-bound own responses, foreign and forged-selector denials, and unchanged victim payroll/year-end/evidence/audit PostgreSQL snapshots. [Year-end annualization and draft 2316/print/Alphalist export PG16 proof](https://github.com/erwinmehehe/payrollph/actions/runs/41446394887) and [separate prior-evidence save/read/approve PG16 proof](https://github.com/erwinmehehe/payrollph/actions/runs/41446394999) are both green on the same final proof head; [JSON read PG16](https://github.com/erwinmehehe/payrollph/actions/runs/41446394862) also passed. `@erwinmehehe` is the repository's only reviewer. The evidence label `SOLO_VERIFIED_DEV_RECOVERY` makes **no claim of independent review**. Existing worker/provider/payout/money/CSP gates stay OFF; no official BIR submissions, production data, global tenant acceptance, or release. Keep draft, do not merge.

## Safety boundary and method evidence contract

Operate only on fictional three-employer fixtures (victim employer A plus attackers B and C), dedicated localhost Next.js in production mode, real disposable PostgreSQL 16 (`/app_db`), temporary test-process-only flags and dummy secrets. **Never** use Neon, a production endpoint/DB, real bank details, real workers, production SQL, deploy flags, new migrations, provider HTTP calls or actual money movement. Preserve `requireDisposable`, existing tests, exact HTTP statuses, and maker/checker/payroll calculation behavior. The existing CI provisioning via `npm run db:push` targets only ephemeral PG; no migration files or production schema are changed by this plan.

A method can become `COVERED` **only after its exact method executes and passes in CI on its PR head** with these **four independently traceable assertions**:

1. **Legitimate positive:** signed-in attacker B, then independently C, successfully accesses/creates/updates/deletes a seeded **own** object through the same method. Confirm response content or DB result refers to the actual own object, not an empty/feature-disabled response. For download/exports assert real synthetic bytes, content type, digest/filename where applicable.
2. **Real victim denial:** create and read back a victim-exclusive row **in the real PG DB**, with a victim object ID above attacker IDs and >6. Use the same authenticated attacker to send the real victim ID; assert the handler's **exact** expected denial (403 or 404 per contract), with no victim data in body, headers, redirects or attachment bytes. A 401, invented-id 404, 429, empty list, never-hit method, or 501 own path is **not** coverage.
3. **Victim remains unchanged:** on POST/PATCH/PUT/DELETE prove by actual before/after PG queries that the victim row and connected records (evidence, ledger, audit, payroll/payout state) are unchanged. For reads snapshot/compare if side effects are possible.
4. **Forged selectors:** repeat with a victim `organizationId`, `employeeId`, `runId`, `legalEntityId`, object path ID or other supplied selector; prove explicit rejection or demonstrate the ID is ignored and actual own-scoped result persists. Do this even when a UI normally hides the parameter.

Write `testedBy` file and **precise test line references for ownPositive, foreignDenial, unchangedDb (mutations), and forgedSelector**. The existing manifest schema has `line`, `ownPositiveLine`, `foreignDenialLine` and `unchangedDbLine`; add a fourth-selector reference only when its live assertion truly exists. Retest previously COVERED claims against this complete contract; do not synthesize missing links. Keep separate exact expected status per endpoint and report unexpected failures as GAP/finding rather than bypassing them.

## Batch queue and grouping rules

Source: [method manifest](../../scripts/qa/tenant-isolation-coverage-manifest.json). One PR per **entire batch** below; keep method membership stable against this baseline, and re-fetch `origin/main` before branching each PR. Methods spanning multiple endpoints stay separate proof cases. A batch PR must report baseline/after counts, methods truly proven, leaks found/fixed, remaining gaps, unchanged-victim snapshots, exact commands/output and the head-SHA GitHub Actions links. Do **not** promote incomplete cases to COVERED to hit a target count.

| Phase | Priority surface | Batch IDs | GAP methods (baseline) |
|---:|---|---|---:|
| 1 | Downloads, exports and files | DL-01, DL-02 | 52 |
| 2 | Money mutations | MNY-01, MNY-02 | 66 |
| 3 | Compliance and statutory | STA-01 | 27 |
| 4 | Personal/employee data | PII-01, PII-02 | 77 |
| 5 | Workforce and multi-entity | WRK-01, WRK-02, WRK-03 | 118 |
| 6 | Auth, public edge and integrations | EDG-01, EDG-02 | 66 |

## PR #1626 Web Bundy all-action proof candidate — DRAFT / NOT ACCEPTED

**Provisional combined ledger:** 498 API methods = 367 COVERED + 10 PUBLIC-BY-DESIGN + 121 GAP. Exactly five Web Bundy lifecycle methods are added to main's Performance credits; DL-02 zero method gaps does not authorize global tenant acceptance, staging, production, photo ingestion, or payroll.

## 2026-10-30 PR #1602 Performance API sync to main@de69f856 — DRAFT, NOT ACCEPTED

**Proposed combined ledger: 498 methods = 362 COVERED + 10 PUBLIC-BY-DESIGN + 126 GAP.** Main's 358 COVERED, including its roster-batches POST and three previously merged #1593 DL-02 proofs remain intact; PR #1602 adds four independently source-bound Performance POST/PATCH methods. 17 page/action GAPs and all frozen batch gaps remain, with exact-head CI and independent security/coverage-owner review required. No payroll, provider, production or tenant-wide authorization.

## 2026-10-31 Draft PR #1642 reconciled with main@ca47c31c — NOT ACCEPTED

**Combined provisional ledger: 498 methods = 378 COVERED + 10 PUBLIC-BY-DESIGN + 110 GAP.** Main contributes 375, PR #1642 adds transfer POST, forecast-plan POST, and scenarios PATCH submit; no double counting. All 17 page/action GAPs remain. Scenarios POST has a separately reported cross-tenant org-unit existence oracle / raw SQL-error disclosure and remains uncredited. Fresh CI/PG16 acceptance, security review, and owner approval are pending. No production authorization.

## 2026-10-31 PR #1612 sync to main@a0cd5b9d — DRAFT, NOT ACCEPTED

**Provisional combined ledger: 498 methods = 375 COVERED + 10 PUBLIC-BY-DESIGN + 113 GAP.** The latest main contributes 371 separately sourced credits, including its newly proven complete Worksites POST ten-action method, and PR #1612 contributes exactly four independent onboarding POST/PATCH method proofs. The 17 page/action GAPs remain. Source-bound PG16 exact-head CI and independent maintainer/security/coverage-owner review are required. No production, payroll, provider payout, deployment or tenant-wide acceptance.

## 2026-10-31 PR #1612 sync to main@5c3785a8 — DRAFT, NOT ACCEPTED

**Provisional combined ledger: 498 methods = 374 COVERED + 10 PUBLIC-BY-DESIGN + 114 GAP.** Current main includes 370 covered methods, including the independently sourced loans PATCH and two HCM write-method proofs; this PR contributes only four distinct onboarding POST/PATCH methods. No source evidence is double-counted. All 17 page/action GAPs remain. Exact-head PG16/CI and independent maintainer/security/coverage-owner review are pending. No production, payroll release, provider payout or tenant-wide acceptance.

## 2026-10-30 current main and #1593 DL-02 review-only reconciliation — DRAFT, NOT ACCEPTED

> **2026-10-30 sync to main@90ffef4911b (DRAFT, NOT ACCEPTED):** Current main includes the separately source-pinned #1591 credits and the two WRK-01 staffing-policy POST/PATCH credits from #1592: **354 COVERED / 10 PUBLIC-BY-DESIGN / 134 GAP**. This PR #1593 adds only three disjoint DL-02 provisional method credits (`POST workforce/demand-observations/import`, `POST self/photo`, `GET web-bundy/evidence`) for **357 COVERED / 10 PUBLIC-BY-DESIGN / 131 GAP** across 498 methods and 17 page/action GAPs. All 12 frozen batches remain INCOMPLETE. Exact-new-head CI and independent security/coverage-owner review are still required; no tenant-wide, production, provider or payroll certification.

**Authoritative proposed manifest snapshot:** exact `main@90ffef4911b32b1f23b9e498079aec8735cea919` with #1592's two staffing-policy proofs preserved, plus only the three additional DL-02 source-pinned, review-PENDING credits from #1593. Their referenced historical fictional PG16 receipt is not a current-head pass; import replay (200) is unproven and `POST web-bundy/evidence` stays GAP. Earlier 341/10/147, 347/10/141, 352/10/136, 354/10/134 and 355/10/133 snapshots are historical, not current acceptance.

**API ledger proposed after main sync:** 295 API routes, **498 methods = 387 COVERED + 10 PUBLIC-BY-DESIGN + 101 GAP**. The PR #1715 base, `main@918085a3779d9386331c77d47ac20d4c8b71458f`, contains **386 COVERED / 10 PUBLIC-BY-DESIGN / 102 GAP**. This PR adds exactly **one** source-pinned `POST webhooks/paymongo/transfers` credit from merged proof #1708 ([passing disposable-PG16 run 41402106010](https://github.com/erwinmehehe/payrollph/actions/runs/41402106010/job/125135951277)); independent security review remains **PENDING**. Scoped page/action ledger remains **4 provisionally COVERED / 17 GAP** of 21. Global tenant isolation remains **NOT ACCEPTED**, and no payroll release, provider payout or deployment is authorized.

### Current 406-method frozen batch queue — 2026-10-29

The frozen twelve-batch queue is a **406-method subset**, not the entire 498-method live API. These rows are recalculated from the exact methods listed below, not copied from the previous dated table.

| Phase | Batch | Frozen methods | COVERED | PUBLIC-BY-DESIGN | GAP | Batch status |
|---:|---|---:|---:|---:|---:|---|
| 1 | **DL-01** | 26 | 23 | 2 | 1 | INCOMPLETE |
| 1 | **DL-02** | 26 | 26 | 0 | 0 | PROVISIONAL — NOT ACCEPTED |
| 2 | **MNY-01** | 33 | 32 | 0 | 1 | INCOMPLETE |
| 2 | **MNY-02** | 33 | 30 | 1 | 2 | INCOMPLETE |
| 3 | **STA-01** | 27 | 25 | 0 | 2 | INCOMPLETE |
| 4 | **PII-01** | 39 | 38 | 0 | 1 | INCOMPLETE |
| 4 | **PII-02** | 38 | 36 | 2 | 0 | PROVISIONAL — NOT ACCEPTED |
| 5 | **WRK-01** | 39 | 39 | 0 | 0 | PROVISIONAL — NOT ACCEPTED |
| 5 | **WRK-02** | 39 | 39 | 0 | 0 | PROVISIONAL — NOT ACCEPTED |
| 5 | **WRK-03** | 40 | 40 | 0 | 0 | PROVISIONAL — NOT ACCEPTED |
| 6 | **EDG-01** | 33 | 10 | 1 | 22 | INCOMPLETE |
| 6 | **EDG-02** | 33 | 26 | 1 | 6 | INCOMPLETE |

Frozen subtotal (2026-11-04 proposal): **364 COVERED + 7 PUBLIC-BY-DESIGN + 35 GAP = 406**. Relative to the live 498-method ledger, the other **92 methods** are **84 COVERED and 8 PUBLIC-BY-DESIGN**. 7 batches remain INCOMPLETE; DL-02, PII-02, WRK-01, WRK-02, WRK-03 remain PROVISIONAL — NOT ACCEPTED.

### Three narrowly promoted API methods — already merged via #1591 (original evidence)

**Already merged #1592 provides the two separate WRK-01 staffing-policy POST/PATCH provisional credits**, citing earlier fictional PG16 [run 40647378457](https://github.com/erwinmehehe/payrollph/actions/runs/40647378457). The source-pinned write proof covers create/replay and submit/approve/reject, while staffing-policy GET remains GAP. Those credits are already included in current `main` and must not be counted again for #1593; independent security/coverage-owner review is still required.

Each row has a currently uncredited method before this proposal, the current `main` route blob equals the dedicated green test head's route blob, and both A/B live fictional own results, higher-ID victim denials, forged selectors and unchanged victim database records are asserted. For multi-action handlers the runner executes every supported nonnegative action variant listed in its `testedBy.methodActions`; no proof of one variant is credited as a complete method.

| Newly COVERED | Merged source PR | Exact final-head PG16 CI | Executable four-part source anchors |
|---|---|---|---|
| `PUT benefits` | [#1560](https://github.com/erwinmehehe/payrollph/pull/1560) | [run 40839189888](https://github.com/erwinmehehe/payrollph/actions/runs/40839189888) (head `e3229c1cbcd4`) | [own L101](https://github.com/erwinmehehe/payrollph/blob/e3229c1cbcd4f61f88a622074f45dccf18fab43d/scripts/qa/tenant-benefit-catalog-put-http.mjs#L101), [foreign L169](https://github.com/erwinmehehe/payrollph/blob/e3229c1cbcd4f61f88a622074f45dccf18fab43d/scripts/qa/tenant-benefit-catalog-put-http.mjs#L169), [unchanged L172](https://github.com/erwinmehehe/payrollph/blob/e3229c1cbcd4f61f88a622074f45dccf18fab43d/scripts/qa/tenant-benefit-catalog-put-http.mjs#L172), [forged L180](https://github.com/erwinmehehe/payrollph/blob/e3229c1cbcd4f61f88a622074f45dccf18fab43d/scripts/qa/tenant-benefit-catalog-put-http.mjs#L180) |
| `POST workforce-planning/demand-handoff` | [#1544](https://github.com/erwinmehehe/payrollph/pull/1544) | [run 40798739712](https://github.com/erwinmehehe/payrollph/actions/runs/40798739712) (head `81e6a5918d6c`) | [own L225](https://github.com/erwinmehehe/payrollph/blob/81e6a5918d6cc9aae79b0fc2311c19ec600fd211/scripts/qa/tenant-wfp-demand-handoff-http.mjs#L225), [foreign L192](https://github.com/erwinmehehe/payrollph/blob/81e6a5918d6cc9aae79b0fc2311c19ec600fd211/scripts/qa/tenant-wfp-demand-handoff-http.mjs#L192), [unchanged L208](https://github.com/erwinmehehe/payrollph/blob/81e6a5918d6cc9aae79b0fc2311c19ec600fd211/scripts/qa/tenant-wfp-demand-handoff-http.mjs#L208), [forged L193](https://github.com/erwinmehehe/payrollph/blob/81e6a5918d6cc9aae79b0fc2311c19ec600fd211/scripts/qa/tenant-wfp-demand-handoff-http.mjs#L193) |
| `PATCH self/performance/action-items` | [#1541](https://github.com/erwinmehehe/payrollph/pull/1541) | [run 40798614855](https://github.com/erwinmehehe/payrollph/actions/runs/40798614855) (head `d528eb30e501`) | [progress L232](https://github.com/erwinmehehe/payrollph/blob/d528eb30e5019190f68b40fae43595eabbe4cc3a/scripts/qa/tenant-self-action-items-http.mjs#L232), [completed L242](https://github.com/erwinmehehe/payrollph/blob/d528eb30e5019190f68b40fae43595eabbe4cc3a/scripts/qa/tenant-self-action-items-http.mjs#L242), [foreign L200](https://github.com/erwinmehehe/payrollph/blob/d528eb30e5019190f68b40fae43595eabbe4cc3a/scripts/qa/tenant-self-action-items-http.mjs#L200), [unchanged L203](https://github.com/erwinmehehe/payrollph/blob/d528eb30e5019190f68b40fae43595eabbe4cc3a/scripts/qa/tenant-self-action-items-http.mjs#L203), [forged L206](https://github.com/erwinmehehe/payrollph/blob/d528eb30e5019190f68b40fae43595eabbe4cc3a/scripts/qa/tenant-self-action-items-http.mjs#L206) |

Proposed receipts are **method authorization evidence only**; the new credit PR must pass its own protected checks and be independently reviewed before merging. No customer database, payroll, payout, bank or external provider was accessed.

### Exhaustive post-#1523 merge screen and open-GAP draft screen

Merged window: **28 actual merged PRs after #1523 at 2026-10-28 15:44:18 UTC**. Scanned every merged PR's changed-file list: `#1552, #1562, #1557, #1560, #1553, #1575, #1570, #1567, #1569, #1574, #1572, #1566, #1559, #1555, #1543, #1556, #1551, #1542, #1550, #1549, #1547, #1544, #1541, #1537, #1546, #1548, #1545, #1536`. Non-API changes and QA-only/nav/page-only changes cannot earn an HTTP method credit. The page-only SSR [#1557](https://github.com/erwinmehehe/payrollph/pull/1557) is still an unaccepted page/action GAP; it does not change the API ledger. Also screened the then-open zero-credit drafts including #1554, #1558, #1576, #1577, #1578, #1582, #1585 and #1589.

**Audited claims: 29 distinct route-method candidates. Promoted 3, skipped 26**: 13 already COVERED elsewhere, 3 partial-action/mode, 5 incomplete four-part evidence, 4 required CI pending, 1 failed exact-head dedicated CI. **Stale-head credited: 0. CI-failed credited: 0.** Methods not shown below were not promoted; out-of-scope PRs aren't counted as an arbitrary API skip.

| Skipped method | PR | Reason category | Exact deficiency / duplicate |
|---|---|---|---|
| `GET benefits` | [#1560](https://github.com/erwinmehehe/payrollph/pull/1560) | ALREADY COVERED | Separate prior enrollment GET receipt retained. |
| `POST benefits` | [#1560](https://github.com/erwinmehehe/payrollph/pull/1560) | ALREADY COVERED | Separate prior enrollment POST receipt retained. |
| `DELETE benefits` | [#1560](https://github.com/erwinmehehe/payrollph/pull/1560) | ALREADY COVERED | Separate prior enrollment DELETE receipt retained. |
| `POST benefits/hmo` | [#1537](https://github.com/erwinmehehe/payrollph/pull/1537) | ALREADY COVERED | All four HMO POST actions already credited from previous four-part proof. |
| `GET workforce-planning/allocations` | [#1536](https://github.com/erwinmehehe/payrollph/pull/1536) | ALREADY COVERED | Prior tenant-table GET proof retained; no double count. |
| `POST payroll-runs` | [#1553](https://github.com/erwinmehehe/payrollph/pull/1553) | ALREADY COVERED | Prior payroll approved-exit POST proof; idempotency fix changes no credit. |
| `GET hcm-report-builder` | [#1576](https://github.com/erwinmehehe/payrollph/pull/1576) | ALREADY COVERED | Prior DL-02 GET proof; draft unmerged. |
| `POST hcm-report-builder` | [#1576](https://github.com/erwinmehehe/payrollph/pull/1576) | ALREADY COVERED | Prior DL-02 POST proof; draft unmerged. |
| `GET reports/builder` | [#1577](https://github.com/erwinmehehe/payrollph/pull/1577) | ALREADY COVERED | Prior DL-02 GET proof; draft unmerged. |
| `POST reports/builder` | [#1577](https://github.com/erwinmehehe/payrollph/pull/1577) | ALREADY COVERED | Prior DL-02 POST proof; draft unmerged. |
| `GET bi-exports` | [#1582](https://github.com/erwinmehehe/payrollph/pull/1582) | ALREADY COVERED | Prior DL-01 batch credit; draft changes unmerged. |
| `GET organizations/[id]/payroll-approvers` | [#1589](https://github.com/erwinmehehe/payrollph/pull/1589) | ALREADY COVERED | Prior GET tenant-table credit; draft unmerged. |
| `GET invitations` | [#1578](https://github.com/erwinmehehe/payrollph/pull/1578) | ALREADY COVERED | Prior tenant-table GET proof; draft GET unit-scope changes not merged. |
| `GET workforce/demand-staffing/policies` | [#1545](https://github.com/erwinmehehe/payrollph/pull/1545) | PARTIAL ACTION | PG16 proof exercises approved mode only; manage-mode GET unproven. |
| `POST workforce-planning/allocations` | [#1536](https://github.com/erwinmehehe/payrollph/pull/1536) | PARTIAL ACTION | Owned allocation create and manager draft, but existing-allocation update and budget/version races unproven. |
| `PATCH workforce-planning/allocations` | [#1536](https://github.com/erwinmehehe/payrollph/pull/1536) | PARTIAL ACTION | Submit/accept/reject positives exist, but all decision-race and flag combinations remain unproven per pinned contract. |
| `POST account/email/verify` | [#1552](https://github.com/erwinmehehe/payrollph/pull/1552) | EVIDENCE INCOMPLETE | Exact-head PG16 green, but two A/B foreign-worker 409 cases and only one legitimate victim-owned 200; no independent A/B owned-success discrimination. |
| `GET careers` | [#1543](https://github.com/erwinmehehe/payrollph/pull/1543) | EVIDENCE INCOMPLETE | Input validation only; no four-part nonempty own/foreign/forged/DB proof for GET. |
| `POST careers` | [#1543](https://github.com/erwinmehehe/payrollph/pull/1543) | EVIDENCE INCOMPLETE | Contact-field validation only; no persisted own-positive with real victim denial, forged ID and unchanged victim SQL. |
| `POST developer` | [#1556](https://github.com/erwinmehehe/payrollph/pull/1556) | EVIDENCE INCOMPLETE | Limiter fallback regression only; no complete create/revoke/manage POST-action proof. |
| `POST signup` | [#1542](https://github.com/erwinmehehe/payrollph/pull/1542) | EVIDENCE INCOMPLETE | Seat-count/limiter hardening, not complete cross-employer 4-part method proof. |
| `GET expenses/receipts` | [#1554](https://github.com/erwinmehehe/payrollph/pull/1554) | CI PENDING | Draft exact-head required checks queued/pending; no passing complete PG16 proof. |
| `POST expenses/receipts` | [#1554](https://github.com/erwinmehehe/payrollph/pull/1554) | CI PENDING | Draft exact-head required checks queued/pending; no passing complete PG16 proof. |
| `POST invitations` | [#1578](https://github.com/erwinmehehe/payrollph/pull/1578) | CI PENDING | Dedicated PG16 HTTP green but required CI on exact draft head still queued; unmerged and no independent review. |
| `POST hcm/employment-term-decisions` | [#1558](https://github.com/erwinmehehe/payrollph/pull/1558) | CI PENDING | Draft required CI queued; complete four-part current-head proof not accepted. |
| `POST hcm/salary-corrections/preview` | [#1585](https://github.com/erwinmehehe/payrollph/pull/1585) | CI FAILED | Dedicated PG16 run 40841015653 failed: legitimate own employer returned HTTP 403, expected 200; required CI also pending. |

**Next work:** #1552 needs independent A/B owned-positive account-token verifications as well as real victim and forged proof. #1536 needs update + race/version cases across full POST/PATCH. #1545 needs `mode=manage`. #1578 must clear queued CI. #1585 must fix [PG16 run 40841015653](https://github.com/erwinmehehe/payrollph/actions/runs/40841015653), where the legitimate owned 200 assertion actually got **403**. The other pending drafts must clear fresh exact-head CI, with independent review. This proposal is deliberately **NOT MERGED**.

## Historical live-manifest batch reconciliation — 2026-10-28

Current proposed reconciliation is source-bound to exact `main@dac65d5681c9fb028b9626d1833f2794c1e71156`, which already includes merged #1519's six independently proven methods, merged #1524's atomic self-profile **source hardening without method credit**, and #1526's single independently credited manager-attestation POST. This PR adds **three disjoint provisional methods** with complete merged-source PG16/localhost HTTP receipts from #1520 and #1514. The proposed combined ledger is **340 COVERED / 10 PUBLIC-BY-DESIGN / 148 GAP** out of **498 API methods**, with **17 page/action GAPs**. The original 2026-10-21 twelve-batch closure queue remains frozen. All batches are INCOMPLETE. None of these provisional credits establishes independent security/privacy, production, payroll, bank, payout or tenant-wide acceptance; source drift fails closed.

| Phase | Batch | Frozen methods | COVERED | PUBLIC-BY-DESIGN | GAP | Batch status |
|---:|---|---:|---:|---:|---:|---|
| 1 | **DL-01** | 26 | 22 | 2 | 2 | INCOMPLETE |
| 1 | **DL-02** | 26 | 26 | 0 | 0 | PROVISIONAL — NOT ACCEPTED |
| 2 | **MNY-01** | 33 | 32 | 0 | 1 | INCOMPLETE |
| 2 | **MNY-02** | 33 | 28 | 0 | 5 | INCOMPLETE |
| 3 | **STA-01** | 27 | 25 | 0 | 2 | INCOMPLETE |
| 4 | **PII-01** | 39 | 38 | 0 | 1 | INCOMPLETE |
| 4 | **PII-02** | 38 | 36 | 0 | 2 | INCOMPLETE |
| 5 | **WRK-01** | 39 | 39 | 0 | 0 | PROVISIONAL — NOT ACCEPTED |
| 5 | **WRK-02** | 39 | 38 | 0 | 1 | INCOMPLETE |
| 5 | **WRK-03** | 40 | 37 | 0 | 3 | INCOMPLETE |
| 6 | **EDG-01** | 33 | 7 | 0 | 26 | INCOMPLETE |
| 6 | **EDG-02** | 33 | 23 | 1 | 9 | INCOMPLETE |

**Live inventory (proposed sweep):** 295 API route files, **498 HTTP methods = 340 COVERED + 10 PUBLIC-BY-DESIGN + 148 GAP**, plus 21 scoped page/action entries (4 provisionally COVERED / 17 GAP). The frozen 406-method queue above is a historical subset; **do not equate its per-batch GAP subtotal with the live global GAP total**. No batch in this snapshot is fully resolved. Tenant-isolation acceptance stays **NOT ACCEPTED**.


**2026-10-28 independently source-pinned follow-on promotions (still NOT ACCEPTED):** The six methods below were GAP at `main@dd890dd65f14a3a508ef5df7227fd84655c21fcd` and retain the precise four-part `testedBy` source lines and matching PR-final-head PostgreSQL 16/localhost HTTP workflow receipts. No open PR was merged or credited during this sweep. This is method evidence only, not an entire-batch or tenant-wide approval.

| Exact HTTP method | Proof PR | Exact-final-head fictional PG16/HTTP receipt |
|---|---|---|
| `GET /api/self/probation-reviews` | [#1507](https://github.com/erwinmehehe/payrollph/pull/1507) | [run 40623884094](https://github.com/erwinmehehe/payrollph/actions/runs/40623884094) |
| `POST /api/self/probation-reviews` | [#1507](https://github.com/erwinmehehe/payrollph/pull/1507) | [run 40623884094](https://github.com/erwinmehehe/payrollph/actions/runs/40623884094) |
| `GET /api/hcm/employment-term-decisions/[id]/manager-attestation` | [#1512](https://github.com/erwinmehehe/payrollph/pull/1512) | [run 40624278478](https://github.com/erwinmehehe/payrollph/actions/runs/40624278478) |
| `GET /api/self/performance` | [#1513](https://github.com/erwinmehehe/payrollph/pull/1513) | [run 40620797757](https://github.com/erwinmehehe/payrollph/actions/runs/40620797757) |
| `POST /api/self/performance` | [#1513](https://github.com/erwinmehehe/payrollph/pull/1513) | [run 40620797757](https://github.com/erwinmehehe/payrollph/actions/runs/40620797757) |
| `PATCH /api/self/performance` | [#1513](https://github.com/erwinmehehe/payrollph/pull/1513) | [run 40620797757](https://github.com/erwinmehehe/payrollph/actions/runs/40620797757) |

**#1523 exact-source, final-proof-head three-method reconciliation (provisional):** The three distinct methods below were `GAP` on `main@dac65d5681c9fb028b9626d1833f2794c1e71156`, and each has a separately merged, real fictional PG16/production-mode localhost HTTP own-positive, genuine victim or stale-membership denial, forged selector and unchanged-victim SQL source. The previously covered manager-attestation POST from #1526 is **not** newly credited here.

| Method | Merged proof PR / real PG16 HTTP receipt | Exact owned, denied, unchanged and forged proof locations |
|---|---|---|
| `GET /api/self/schedule-receipts` | [#1520](https://github.com/erwinmehehe/payrollph/pull/1520), [run 40631756084](https://github.com/erwinmehehe/payrollph/actions/runs/40631756084) | [own L123](../../scripts/qa/tenant-self-schedule-receipts-http.mjs#L123), [victim L222](../../scripts/qa/tenant-self-schedule-receipts-http.mjs#L222), [unchanged L253](../../scripts/qa/tenant-self-schedule-receipts-http.mjs#L253), [forged L131](../../scripts/qa/tenant-self-schedule-receipts-http.mjs#L131) |
| `POST /api/self/schedule-receipts` | [#1520](https://github.com/erwinmehehe/payrollph/pull/1520), [run 40631756084](https://github.com/erwinmehehe/payrollph/actions/runs/40631756084) | [own L144](../../scripts/qa/tenant-self-schedule-receipts-http.mjs#L144), [victim L224](../../scripts/qa/tenant-self-schedule-receipts-http.mjs#L224), [unchanged L253](../../scripts/qa/tenant-self-schedule-receipts-http.mjs#L253), [forged L197](../../scripts/qa/tenant-self-schedule-receipts-http.mjs#L197) |
| `GET /api/workforce/demand-observations/issued` | [#1514](https://github.com/erwinmehehe/payrollph/pull/1514), [run 40624976387](https://github.com/erwinmehehe/payrollph/actions/runs/40624976387) | [own L159](../../scripts/qa/tenant-demand-governance-recovery-http.mjs#L159), [victim L177](../../scripts/qa/tenant-demand-governance-recovery-http.mjs#L177), [unchanged L272](../../scripts/qa/tenant-demand-governance-recovery-http.mjs#L272), [forged L195](../../scripts/qa/tenant-demand-governance-recovery-http.mjs#L195) |

**Explicit source-drift/privacy hold:** Merged #1524 changed `PATCH /api/self/profile` from its #1518 historical route blob to `41d26b23678e8822aff4701a611c429e97f659c3`. #1524's isolated PG16/HTTP source checks are preserved but marked `reviewedUncertified`; `PATCH self/profile` stays **GAP**, `testedBy:null` and `independentReview:PENDING`. This sweep does **not** borrow the old blob, change the route, relabel source-only proof as owner acceptance or permit a fourth credit. Likewise, approved-mode staffing-policy GET, demand-observations issued POST and Web Bundy consent POST remain GAP. All 17 page/action GAPs remain unchanged.

**Historical #1519 distinct-method audit ledger (42 targets):** **6 newly promoted**, **36 skipped**: **21 already COVERED** (16 previously credited by #1509, four holiday methods #1504, document GET #1497); **8 partial-action proofs** (#1464 recruitment/privacy PATCH, #1473 roster POST, #1481 capabilities POST, #1482 loans PATCH, #1493 governance PATCH, #1496 careers/admin PATCH, #1500 workforce allocation POST, #1508 generic approvals PATCH); **7 incomplete or still-open evidence** (year-end GET #1468/#1480, two demand governance GETs #1474, invitations POST #1499, filing outcome PATCH #1501, HMO POST #1492, consent POST #1505); **0 stale source matches among the six credited methods**. #1514 is open and duplicates the two uncredited workforce-demand GETs; #1515 is open and repeats already-credited ESS availability. #1502 duplicates the covered #1503 take-home GET. Do not count any duplicate twice. Additional older already-credited proof families retain their original source ownership.

**Scope holds:** #1505 consent remains open, with independent privacy/DPO assessment and shared CI/security checks outstanding; no merge or credit. #1492 synthetic HMO `update_enrollment` does not exercise the `coverage_activated`/`coverage_ended` automation branches. #1499's authored receipt explicitly retains `methodFullyCovered:false`; #1501 covers rejected rather than accepted outcome. #1508 only proves unlinked generic approvals. Manager-attestation POST has a separate, provisional #1526 local-PG18 candidate, pending exact-head PG16 CI and independent reviewer acceptance. No Neon, production, real money or provider calls occurred.

**Whole-batch rule:** The next phase-1 target is **DL-01**, not a renamed sub-slice. One new proof PR must account for **all five remaining DL-01 methods**, keep already evidenced methods' proof ownership, and supply own-positive, real-victim denial, unchanged-victim DB and forged-selector evidence on its exact CI head. Do not create a smaller methods-credit PR or claim a method passes from a source-only test. If a remaining handler cannot be positively exercised under the disposable/no-provider boundary, report the per-method owner blocker and **stop** rather than splitting into ad-hoc slices. Future titles must include the exact batch ID.

### Batch DL-01 — Tax, statutory, payroll exports and employee document/import files (26 methods; phase 1)

**Shared fixture:** PDF/csv bytes, statutory batches, payroll run, real vault/document row and employee import; no provider. **Status (live manifest at main@a7dc1f5184f5):** 19 COVERED / 2 PUBLIC-BY-DESIGN / 5 GAP across 26 frozen methods; **BATCH INCOMPLETE**. Remaining listed GAP: `GET /api/year-end/prior-evidence`, `POST /api/year-end/prior-evidence`, `POST /api/payroll-runs/[id]/exports`, `POST /api/documents`, `POST /api/employees/import`.

**DL-01 full-batch evidence gate (no new credits in this reconciliation):** The remaining five methods are `GET`/`POST /api/year-end/prior-evidence`, `POST /api/payroll-runs/[id]/exports`, `POST /api/documents` and `POST /api/employees/import`. The payout-export POST is a multi-action handler: its `disburse` action submits a **real PayMongo payout**, its `preflight` queries the live provider, its default Xendit rail fails closed with `501`, and its `complete-manual` action requires independently validated bank-payment evidence. A successful synthetic manual action alone **cannot certify the whole handler**. `POST /api/documents` also requires an HTTPS malware-scanner response and production upload/storage gates. The two prior-evidence actions and employee import still require independent real-HTTP/PG16 two-attacker/victim/forged-selector proofs under explicitly test-process-only flags. **No new DL-01 method may become COVERED from feature-disabled 404/501, partial-action success, mocked response without executed HTTP, or fabricated payout confirmation.**

**DL-01 adapter owner decision, 2026-10-26:** The Payroll/Treasury and document/storage owners have now approved **disposable test-only** adapters. [Draft whole-batch PR #1444](https://github.com/erwinmehehe/payrollph/pull/1444) adds localhost-only PayMongo zero-money responses, HTTPS synthetic scanner and in-memory object storage (plus kernel outbound firewall), and a shared four-part proof runner for **all five** remaining listed methods. This authorizes **only isolated testing**, never provider connectivity, bank verification, production payout flags or a live money transfer. **Status remains 19 COVERED / 2 PUBLIC-BY-DESIGN / 5 GAP until every method's four-part real HTTP/disposable PG16 evidence passes on the exact PR head, source/CI receipt pins are independently reviewed and the live manifest is regenerated.** The complete-manual fixture is explicitly fictional CI control-flow evidence, not acceptance by a receiving bank. Do not claim any new method credit or mark DL-01 complete from source code alone.

- `GET /api/bir/annual-employer/module-evidence` — [source](../../src/app/api/bir/annual-employer/module-evidence/route.ts#L65)
- `POST /api/bir/annual-employer/module-evidence` — [source](../../src/app/api/bir/annual-employer/module-evidence/route.ts#L110)
- `GET /api/compliance/contribution-issues/evidence` — [source](../../src/app/api/compliance/contribution-issues/evidence/route.ts#L41)
- `GET /api/compliance/filing-validations/[id]/file` — [source](../../src/app/api/compliance/filing-validations/[id]/file/route.ts#L14)
- `GET /api/compliance/labor-inspection/evidence-pack` — [source](../../src/app/api/compliance/labor-inspection/evidence-pack/route.ts#L23)
- `GET /api/compliance/statutory-remittances/payment-evidence` — [source](../../src/app/api/compliance/statutory-remittances/payment-evidence/route.ts#L57)
- `POST /api/compliance/statutory-remittances/payment-evidence` — [source](../../src/app/api/compliance/statutory-remittances/payment-evidence/route.ts#L108)
- `GET /api/compliance/statutory-remittances/payment-evidence/[id]` — [source](../../src/app/api/compliance/statutory-remittances/payment-evidence/[id]/route.ts#L11)
- `GET /api/compliance/statutory-remittances/posting-evidence/[id]` — [source](../../src/app/api/compliance/statutory-remittances/posting-evidence/[id]/route.ts#L22)
- `GET /api/compliance/statutory-remittances/posting-import` — [source](../../src/app/api/compliance/statutory-remittances/posting-import/route.ts#L41)
- `POST /api/compliance/statutory-remittances/posting-import` — [source](../../src/app/api/compliance/statutory-remittances/posting-import/route.ts#L52)
- `GET /api/year-end/2316-certificate` — [source](../../src/app/api/year-end/2316-certificate/route.ts#L84)
- `POST /api/year-end/2316-certificate` — [source](../../src/app/api/year-end/2316-certificate/route.ts#L85)
- `GET /api/year-end/prior-evidence` — [source](../../src/app/api/year-end/prior-evidence/route.ts#L33)
- `POST /api/year-end/prior-evidence` — [source](../../src/app/api/year-end/prior-evidence/route.ts#L34)
- `GET /api/separation/[id]/2316` — [source](../../src/app/api/separation/[id]/2316/route.ts#L29)
- `GET /api/payroll-runs/[id]/exports` — [source](../../src/app/api/payroll-runs/[id]/exports/route.ts#L51)
- `POST /api/payroll-runs/[id]/exports` — [source](../../src/app/api/payroll-runs/[id]/exports/route.ts#L316)
- `GET /api/bi-exports` — [source](../../src/app/api/bi-exports/route.ts#L28)
- `GET /api/exports` — [source](../../src/app/api/exports/route.ts#L19)
- `POST /api/documents` — [source](../../src/app/api/documents/route.ts#L115)
- `GET /api/employee-vault` — [source](../../src/app/api/employee-vault/route.ts#L13)
- `DELETE /api/employee-vault/[id]` — [source](../../src/app/api/employee-vault/[id]/route.ts#L15)
- `GET /api/employees/import` — [source](../../src/app/api/employees/import/route.ts#L269)
- `POST /api/employees/import` — [source](../../src/app/api/employees/import/route.ts#L19)
- `GET /api/employees/import/template` — [source](../../src/app/api/employees/import/template/route.ts#L14)

### Batch DL-02 — Self-service files, HR evidence, photos, report exports and workforce evidence (26 methods; phase 1)

**Shared fixture:** employee principal, HR document, photo bytes, workforce evidence, report config and nonempty export. **Status (live manifest at main@a7dc1f5184f5):** 22 COVERED / 0 PUBLIC-BY-DESIGN / 4 GAP across 26 frozen methods; **BATCH INCOMPLETE**. Remaining listed GAP: `POST /api/self/photo`, `GET /api/web-bundy/evidence`, `POST /api/web-bundy/evidence`, `POST /api/workforce/demand-observations/import`. Prior partial work: [#1328](https://github.com/erwinmehehe/payrollph/pull/1328), not whole-batch closure. **Whole-batch PR:** [#1441](https://github.com/erwinmehehe/payrollph/pull/1441) (draft): all four remaining methods have family-file executable proof scenarios; no additional COVERED credit until exact-head real HTTP/PG16 CI has passed and precise source/receipt pins are reviewed. Never count the earlier 22 again.

**Route-specific denial evidence:** `GET`/`HEAD`/`DELETE /api/self/photo` and `GET /api/self/contribution-evidence` are session-derived self-service endpoints that accept no client-selected employer or victim-object ID. For each of two independent synthetic employee employers, their specific negative control is **the same signed-in employee's access denied with 403 after revoking that employee's active employer membership**, following a real own-request 200. A separate victim employer's PostgreSQL snapshot remains unchanged. These are *revoked-membership* controls, not fabricated foreign-object selector requests; other DL-02 routes exercise actual foreign-employer or victim-object denials.

**Proof-integrity reinforcement:** This batch seeds two real attacker-employer populations and their saved report POST objects **before** creating the victim-exclusive targets. Victim IDs are read back from disposable PostgreSQL and required to exceed each attacker-owned corresponding object ID, rather than only a fixed sequence floor. Report POST positives must contain seeded employer-specific employee counts/rows; report GET catalogs are labeled as authorized field metadata and paired with foreign-tenant 403 controls, not falsely claimed as owned-row exports. Performance GET must return a real synthetic cycle/review JSON document and matching section/snapshot SHA256. The unchanged victim DB snapshot now includes employment decisions/terms, employees, payroll runs/entries and performance cycles/reviews. Rebuild source-line manifest pins and rerun applicable exact-head CI before any `COVERED` disposition is accepted.


**2026-10-28 DL-02 coverage-credit hold — verification snapshot at `main@a7dc1f5184f59f3c5ac348e37b4ca88810f10651`.** This is a blocker record, **not** acceptance or a coverage promotion. The [live manifest at this head](https://github.com/erwinmehehe/payrollph/blob/a7dc1f5184f59f3c5ac348e37b4ca88810f10651/scripts/qa/tenant-isolation-coverage-manifest.json) still reports **22 COVERED / 0 PUBLIC-BY-DESIGN / 4 GAP** for DL-02, with `testedBy: null` on each of the four listed remaining methods.

- **Security review / CodeQL #76:** The [CodeQL inline review thread on PR #1441](https://github.com/erwinmehehe/payrollph/pull/1441#discussion_r4379605453) is marked **resolved** in GitHub's review-thread state. However, the underlying [code-scanning alert #76](https://github.com/erwinmehehe/payrollph/security/code-scanning/76) open/closed state was **not independently verifiable** through the available alert-read access. Require explicit security-owner confirmation that the alert itself is closed or appropriately dispositioned; a green CodeQL workflow does not substitute for that confirmation.
- **Current-main exact-head HTTP/PG16 proof missing:** [PR #1441's successful whole-batch run #40430046118](https://github.com/erwinmehehe/payrollph/actions/runs/40430046118) executed on `5d265cc73424f8d73343daf8ff02e6a50cc550a8`, **not** the audited `main@a7dc1f5...` head. None of the 17 Actions runs listed for this audited head was the [DL-02 whole-batch workflow](https://github.com/erwinmehehe/payrollph/actions/workflows/tenant-dl02-closure.yml), which is PR-path-triggered or manually dispatchable. An earlier-head success is not current-head acceptance. Run the complete four-method, two-attacker, real disposable PG16 HTTP proof on the exact head to be credited and retain its successful run URL and precise `tenant-dl02-rows/*.mjs` proof-line receipts.
- **Required same-head full CI/check not yet passed:** [CI run #40610674710](https://github.com/erwinmehehe/payrollph/actions/runs/40610674710) on the audited `a7dc1f5...` head was **queued** at inspection, so the full PG16/18 regression and audit matrix was not established. Confirm it passes on the **same SHA** as the whole-batch proof, and recheck if `main` advances.
- **Phase-1 batch order and inventory:** Independent counting of the same live manifest gives **DL-01 = 19 COVERED / 2 PUBLIC-BY-DESIGN / 5 GAP** and **DL-02 = 22 COVERED / 0 PUBLIC-BY-DESIGN / 4 GAP**. DL-01 is not complete and DL-02 cannot be called the second complete batch. The global live manifest reports **498 API methods = 314 COVERED + 10 PUBLIC-BY-DESIGN + 174 GAP**; the older headline snapshots in this document remain historical until a separately reviewed reconciliation.

**2026-10-28 execution follow-up, on PR #1506's documentation-only head (not `main`):** [DL-02 whole-batch run 40611079056](https://github.com/erwinmehehe/payrollph/actions/runs/40611079056) completed **success** on `60c940b80d63b696e1981d408464bc233cb61b28`, executing 26 source/negative tests and the four-method two-attacker, real higher-ID victim PostgreSQL 16 + localhost HTTP receipt (`ownMethodEvidence=true`, `realForeignDenial=true`, `forgedSelectorsChecked=true`, `victimDatabaseUnchanged=true`). Because #1506 changes **only this closure-plan Markdown file**, its application handlers and proof scripts are blob-identical to `main@a7dc1f5`. This is meaningful current-source PR evidence, but **it is not an Actions run whose head SHA is the actual `main` commit**, so do not relabel it current-`main` acceptance or promote its four methods.

On the same PR #1506 head, [CodeQL Security 40611079090](https://github.com/erwinmehehe/payrollph/actions/runs/40611079090) and [Security HTTP Smoke 40611078827](https://github.com/erwinmehehe/payrollph/actions/runs/40611078827) have also completed **success**. Their workflow results do **not** establish the separate open/closed state of underlying CodeQL security alert #76 or constitute independent security-owner disposition. [PR-head full CI 40611079094](https://github.com/erwinmehehe/payrollph/actions/runs/40611079094) and [actual `main` full CI 40610674710](https://github.com/erwinmehehe/payrollph/actions/runs/40610674710) were still queued at this follow-up check. Treat them as **unverified**, never green by inference.

**Precise remaining gates, in order:** (1) a security owner reads [CodeQL alert #76](https://github.com/erwinmehehe/payrollph/security/code-scanning/76) and records an explicit justified disposition, rather than trusting the resolved inline thread or unrelated CodeQL green check; (2) an authorized maintainer uses **Actions → Tenant DL-02 whole-batch proof → Run workflow → main** (the workflow already supports `workflow_dispatch`) and verifies the successful run's **actual `head_sha` is the newest `main` commit**; (3) full `CI/check` including relevant PostgreSQL/audit checks passes on **that exact same `main` SHA**; (4) owner/security reviewer compares the four named method-specific own-positive, real-victim denial, forged-selector and unchanged-victim lines to live handler action scope, verifies current `testedBy:null` state and DL-01 remaining 5 GAPs, and only then proposes a **separate reviewable manifest-credit PR**. Do not run against Neon, production, actual employee photos, payment providers or money.


**Disposition:** **DL-02 BATCH INCOMPLETE / NOT ACCEPTED.** No status, `testedBy`, proof-line, manifest-credit, or closure-summary changes are authorized by this audit. Re-evaluate all three gates on a newly fetched exact head before proposing promotion. Use disposable fictional PG16/localhost fixtures only; no Neon, production, real money or provider calls.

- `GET /api/hcm-report-builder` — [source](../../src/app/api/hcm-report-builder/route.ts#L43)
- `POST /api/hcm-report-builder` — [source](../../src/app/api/hcm-report-builder/route.ts#L61)
- `GET /api/hcm/documents` — [source](../../src/app/api/hcm/documents/route.ts#L59)
- `POST /api/hcm/documents` — [source](../../src/app/api/hcm/documents/route.ts#L248)
- `GET /api/hcm/employment-term-decisions/[id]/evidence` — [source](../../src/app/api/hcm/employment-term-decisions/[id]/evidence/route.ts#L100)
- `POST /api/hcm/employment-term-decisions/[id]/evidence` — [source](../../src/app/api/hcm/employment-term-decisions/[id]/evidence/route.ts#L136)
- `GET /api/multi-entity/reports` — [source](../../src/app/api/multi-entity/reports/route.ts#L11)
- `GET /api/performance/evidence` — [source](../../src/app/api/performance/evidence/route.ts#L16)
- `DELETE /api/report-builder/saved` — [source](../../src/app/api/report-builder/saved/route.ts#L102)
- `GET /api/report-builder/saved` — [source](../../src/app/api/report-builder/saved/route.ts#L35)
- `PATCH /api/report-builder/saved` — [source](../../src/app/api/report-builder/saved/route.ts#L74)
- `POST /api/report-builder/saved` — [source](../../src/app/api/report-builder/saved/route.ts#L48)
- `GET /api/reports` — [source](../../src/app/api/reports/route.ts#L13)
- `GET /api/reports/builder` — [source](../../src/app/api/reports/builder/route.ts#L69)
- `POST /api/reports/builder` — [source](../../src/app/api/reports/builder/route.ts#L80)
- `GET /api/self/contribution-evidence` — [source](../../src/app/api/self/contribution-evidence/route.ts#L48)
- `GET /api/self/documents` — [source](../../src/app/api/self/documents/route.ts#L47)
- `POST /api/self/documents` — [source](../../src/app/api/self/documents/route.ts#L147)
- `POST /api/self/payslips` — [source](../../src/app/api/self/payslips/route.ts#L371)
- `DELETE /api/self/photo` — [source](../../src/app/api/self/photo/route.ts#L136)
- `GET /api/self/photo` — [source](../../src/app/api/self/photo/route.ts#L59)
- `HEAD /api/self/photo` — [source](../../src/app/api/self/photo/route.ts#L62)
- `POST /api/self/photo` — [source](../../src/app/api/self/photo/route.ts#L66)
- `GET /api/web-bundy/evidence` — [source](../../src/app/api/web-bundy/evidence/route.ts#L60)
- `POST /api/web-bundy/evidence` — [source](../../src/app/api/web-bundy/evidence/route.ts#L88)
- `POST /api/workforce/demand-observations/import` — [source](../../src/app/api/workforce/demand-observations/import/route.ts#L17)

### Batch MNY-01 — Payroll lifecycle, payout destinations and compensation (33 methods; phase 2)

**Shared fixture:** draft/released payroll run, distinct payer/payee, bounded fictional state transitions; no transfer/release to provider. **Status (live manifest at main@a7dc1f5184f5):** 20 COVERED / 0 PUBLIC-BY-DESIGN / 13 GAP across 33 frozen methods; **BATCH INCOMPLETE**. Remaining listed GAP: `POST /api/payroll-runs/[id]/payout-reconciliation`, `POST /api/payroll-runs/[id]/pilot-signoff`, `POST /api/payroll-runs/[id]/release`, `POST /api/payroll-runs/[id]/submit-review`, `GET /api/payroll-runs/[id]/xendit-payout`, `POST /api/payroll-runs/[id]/xendit-payout`, `POST /api/payroll/overpayment-preflight`, `PATCH /api/payout-profiles`, `PATCH /api/compensation`, `POST /api/compensation`, `POST /api/earned-wage`, `GET /api/year-end`, `POST /api/year-end`.

- `GET /api/payroll-runs/[id]/close` — [source](../../src/app/api/payroll-runs/[id]/close/route.ts#L135)
- `POST /api/payroll-runs/[id]/close` — [source](../../src/app/api/payroll-runs/[id]/close/route.ts#L148)
- `GET /api/payroll-runs/[id]/connected-impact` — [source](../../src/app/api/payroll-runs/[id]/connected-impact/route.ts#L27)
- `POST /api/payroll-runs/[id]/payout-reconciliation` — [source](../../src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts#L211)
- `POST /api/payroll-runs/[id]/pilot-signoff` — [source](../../src/app/api/payroll-runs/[id]/pilot-signoff/route.ts#L75)
- `POST /api/payroll-runs/[id]/process` — [source](../../src/app/api/payroll-runs/[id]/process/route.ts#L18)
- `POST /api/payroll-runs/[id]/release` — [source](../../src/app/api/payroll-runs/[id]/release/route.ts#L30)
- `POST /api/payroll-runs/[id]/submit-review` — [source](../../src/app/api/payroll-runs/[id]/submit-review/route.ts#L21)
- `GET /api/payroll-runs/[id]/variance` — [source](../../src/app/api/payroll-runs/[id]/variance/route.ts#L57)
- `GET /api/payroll-runs/[id]/xendit-payout` — [source](../../src/app/api/payroll-runs/[id]/xendit-payout/route.ts#L62)
- `POST /api/payroll-runs/[id]/xendit-payout` — [source](../../src/app/api/payroll-runs/[id]/xendit-payout/route.ts#L91)
- `GET /api/payroll-underpayments` — [source](../../src/app/api/payroll-underpayments/route.ts#L53)
- `PATCH /api/payroll-underpayments` — [source](../../src/app/api/payroll-underpayments/route.ts#L236)
- `POST /api/payroll-underpayments` — [source](../../src/app/api/payroll-underpayments/route.ts#L104)
- `GET /api/payroll-earnings` — [source](../../src/app/api/payroll-earnings/route.ts#L133)
- `PATCH /api/payroll-earnings` — [source](../../src/app/api/payroll-earnings/route.ts#L310)
- `POST /api/payroll-earnings` — [source](../../src/app/api/payroll-earnings/route.ts#L183)
- `GET /api/payroll-overpayment-preview` — [source](../../src/app/api/payroll-overpayment-preview/route.ts#L45)
- `POST /api/payroll-overpayment-preview` — [source](../../src/app/api/payroll-overpayment-preview/route.ts#L78)
- `GET /api/payroll/overpayment-preflight` — [source](../../src/app/api/payroll/overpayment-preflight/route.ts#L64)
- `POST /api/payroll/overpayment-preflight` — [source](../../src/app/api/payroll/overpayment-preflight/route.ts#L102)
- `GET /api/payout-destination-changes` — [source](../../src/app/api/payout-destination-changes/route.ts#L10)
- `PATCH /api/payout-destination-changes/[id]` — [source](../../src/app/api/payout-destination-changes/[id]/route.ts#L10)
- `GET /api/payout-profiles` — [source](../../src/app/api/payout-profiles/route.ts#L69)
- `PATCH /api/payout-profiles` — [source](../../src/app/api/payout-profiles/route.ts#L138)
- `GET /api/compensation` — [source](../../src/app/api/compensation/route.ts#L242)
- `PATCH /api/compensation` — [source](../../src/app/api/compensation/route.ts#L825)
- `POST /api/compensation` — [source](../../src/app/api/compensation/route.ts#L472)
- `GET /api/earned-wage` — [source](../../src/app/api/earned-wage/route.ts#L25)
- `PATCH /api/earned-wage` — [source](../../src/app/api/earned-wage/route.ts#L182)
- `POST /api/earned-wage` — [source](../../src/app/api/earned-wage/route.ts#L98)
- `GET /api/year-end` — [source](../../src/app/api/year-end/route.ts#L23)
- `POST /api/year-end` — [source](../../src/app/api/year-end/route.ts#L378)

### Batch MNY-02 — Loans, contractors, expenses, billing and treasury (33 methods; phase 2)

**Shared fixture:** fictional loan, contractor, invoice, expense, card/budget and maker/checker records; no external payment. **Status (live manifest at main@a7dc1f5184f5):** 21 COVERED / 0 PUBLIC-BY-DESIGN / 12 GAP across 33 frozen methods; **BATCH INCOMPLETE**. Remaining listed GAP: `PATCH /api/approvals/[id]`, `POST /api/billing`, `POST /api/billing/subscription/cancel`, `POST /api/billing/subscription/start`, `GET /api/expenses/receipts`, `POST /api/expenses/receipts`, `PATCH /api/loans`, `POST /api/managed-payroll/runs/[id]/approve`, `POST /api/payroll-outsourcing/quote`, `PATCH /api/spend`, `POST /api/spend`, `POST /api/treasury-controls`.

- `POST /api/approval-chains` — [source](../../src/app/api/approval-chains/route.ts#L72)
- `PATCH /api/approvals/[id]` — [source](../../src/app/api/approvals/[id]/route.ts#L33)
- `GET /api/billing` — [source](../../src/app/api/billing/route.ts#L24)
- `POST /api/billing` — [source](../../src/app/api/billing/route.ts#L64)
- `GET /api/billing/subscription` — [source](../../src/app/api/billing/subscription/route.ts#L12)
- `POST /api/billing/subscription/cancel` — [source](../../src/app/api/billing/subscription/cancel/route.ts#L16)
- `POST /api/billing/subscription/start` — [source](../../src/app/api/billing/subscription/start/route.ts#L18)
- `DELETE /api/contractors` — [source](../../src/app/api/contractors/route.ts#L167)
- `GET /api/contractors` — [source](../../src/app/api/contractors/route.ts#L9)
- `PATCH /api/contractors` — [source](../../src/app/api/contractors/route.ts#L96)
- `POST /api/contractors` — [source](../../src/app/api/contractors/route.ts#L38)
- `GET /api/contractors/payments` — [source](../../src/app/api/contractors/payments/route.ts#L42)
- `POST /api/contractors/payments` — [source](../../src/app/api/contractors/payments/route.ts#L187)
- `DELETE /api/de-minimis` — [source](../../src/app/api/de-minimis/route.ts#L170)
- `GET /api/de-minimis` — [source](../../src/app/api/de-minimis/route.ts#L20)
- `POST /api/de-minimis` — [source](../../src/app/api/de-minimis/route.ts#L65)
- `GET /api/expenses` — [source](../../src/app/api/expenses/route.ts#L15)
- `PATCH /api/expenses` — [source](../../src/app/api/expenses/route.ts#L197)
- `POST /api/expenses` — [source](../../src/app/api/expenses/route.ts#L94)
- `GET /api/expenses/receipts` — [source](../../src/app/api/expenses/receipts/route.ts#L45)
- `POST /api/expenses/receipts` — [source](../../src/app/api/expenses/receipts/route.ts#L87)
- `GET /api/loans` — [source](../../src/app/api/loans/route.ts#L39)
- `PATCH /api/loans` — [source](../../src/app/api/loans/route.ts#L219)
- `POST /api/loans` — [source](../../src/app/api/loans/route.ts#L105)
- `POST /api/loans/schedule-preview` — [source](../../src/app/api/loans/schedule-preview/route.ts#L16)
- `POST /api/managed-payroll/runs/[id]/approve` — [source](../../src/app/api/managed-payroll/runs/[id]/approve/route.ts#L17)
- `GET /api/organizations/[id]/payroll-approvers` — [source](../../src/app/api/organizations/[id]/payroll-approvers/route.ts#L15)
- `POST /api/payroll-outsourcing/quote` — [source](../../src/app/api/payroll-outsourcing/quote/route.ts#L16)
- `GET /api/spend` — [source](../../src/app/api/spend/route.ts#L36)
- `PATCH /api/spend` — [source](../../src/app/api/spend/route.ts#L190)
- `POST /api/spend` — [source](../../src/app/api/spend/route.ts#L76)
- `GET /api/treasury-controls` — [source](../../src/app/api/treasury-controls/route.ts#L56)
- `POST /api/treasury-controls` — [source](../../src/app/api/treasury-controls/route.ts#L120)

### Batch STA-01 — Statutory remittance, government loan, labor inspection and data requests (27 methods; phase 3)

**Shared fixture:** same fictional statutory batch, contribution task, BIR filing, loan, data request and labor case. **Status (live manifest at main@a7dc1f5184f5):** 21 COVERED / 0 PUBLIC-BY-DESIGN / 6 GAP across 27 frozen methods; **BATCH INCOMPLETE**. Remaining listed GAP: `POST /api/bir/annual-employer/candidate`, `POST /api/compliance/contribution-issues`, `PATCH /api/compliance/filing-validations/[id]`, `POST /api/compliance/labor-inspection`, `POST /api/compliance/payroll-month-close`, `POST /api/compliance/statutory-remittances`.

- `GET /api/bir/annual-employer` — [source](../../src/app/api/bir/annual-employer/route.ts#L13)
- `POST /api/bir/annual-employer/candidate` — [source](../../src/app/api/bir/annual-employer/candidate/route.ts#L49)
- `GET /api/compliance/audit-chain` — [source](../../src/app/api/compliance/audit-chain/route.ts#L9)
- `GET /api/compliance/contribution-issues` — [source](../../src/app/api/compliance/contribution-issues/route.ts#L57)
- `POST /api/compliance/contribution-issues` — [source](../../src/app/api/compliance/contribution-issues/route.ts#L129)
- `GET /api/compliance/data-requests` — [source](../../src/app/api/compliance/data-requests/route.ts#L32)
- `PATCH /api/compliance/data-requests` — [source](../../src/app/api/compliance/data-requests/route.ts#L199)
- `POST /api/compliance/data-requests` — [source](../../src/app/api/compliance/data-requests/route.ts#L149)
- `GET /api/compliance/dole-13th-month` — [source](../../src/app/api/compliance/dole-13th-month/route.ts#L42)
- `POST /api/compliance/dole-13th-month` — [source](../../src/app/api/compliance/dole-13th-month/route.ts#L137)
- `GET /api/compliance/filing-validations` — [source](../../src/app/api/compliance/filing-validations/route.ts#L20)
- `POST /api/compliance/filing-validations` — [source](../../src/app/api/compliance/filing-validations/route.ts#L65)
- `PATCH /api/compliance/filing-validations/[id]` — [source](../../src/app/api/compliance/filing-validations/[id]/route.ts#L21)
- `GET /api/compliance/government-loan-remittances` — [source](../../src/app/api/compliance/government-loan-remittances/route.ts#L70)
- `POST /api/compliance/government-loan-remittances` — [source](../../src/app/api/compliance/government-loan-remittances/route.ts#L143)
- `GET /api/compliance/labor-inspection` — [source](../../src/app/api/compliance/labor-inspection/route.ts#L32)
- `POST /api/compliance/labor-inspection` — [source](../../src/app/api/compliance/labor-inspection/route.ts#L47)
- `GET /api/compliance/labor-inspection/drills` — [source](../../src/app/api/compliance/labor-inspection/drills/route.ts#L48)
- `POST /api/compliance/labor-inspection/drills` — [source](../../src/app/api/compliance/labor-inspection/drills/route.ts#L90)
- `GET /api/compliance/payroll-month-close` — [source](../../src/app/api/compliance/payroll-month-close/route.ts#L40)
- `POST /api/compliance/payroll-month-close` — [source](../../src/app/api/compliance/payroll-month-close/route.ts#L84)
- `GET /api/compliance/policy-review` — [source](../../src/app/api/compliance/policy-review/route.ts#L12)
- `GET /api/compliance/remittance-actions` — [source](../../src/app/api/compliance/remittance-actions/route.ts#L93)
- `POST /api/compliance/remittance-actions` — [source](../../src/app/api/compliance/remittance-actions/route.ts#L109)
- `GET /api/compliance/statutory-remittances` — [source](../../src/app/api/compliance/statutory-remittances/route.ts#L64)
- `POST /api/compliance/statutory-remittances` — [source](../../src/app/api/compliance/statutory-remittances/route.ts#L103)
- `POST /api/compliance/validate` — [source](../../src/app/api/compliance/validate/route.ts#L30)

### Batch PII-01 — HCM worker and lifecycle identities (39 methods; phase 4)

**Shared fixture:** worker profile, job, employment-term decision, organization tree, worker-360 and related documents. **Status (proposed from main@dd890dd65f14):** 32 COVERED / 0 PUBLIC-BY-DESIGN / 7 GAP across 39 frozen methods; **BATCH INCOMPLETE**. Remaining listed GAP: `POST /api/hcm/business-processes/definitions`, `POST /api/hcm/capabilities`, `POST /api/hcm/effective-changes`, `POST /api/hcm/employment-term-decisions`, `POST /api/hcm/employment-term-decisions/[id]/manager-attestation`, `POST /api/hcm/salary-corrections/preview`, `POST /api/hcm/work-items/escalate`.

- `GET /api/hcm/business-processes/definitions` — [source](../../src/app/api/hcm/business-processes/definitions/route.ts#L48)
- `POST /api/hcm/business-processes/definitions` — [source](../../src/app/api/hcm/business-processes/definitions/route.ts#L89)
- `GET /api/hcm/capabilities` — [source](../../src/app/api/hcm/capabilities/route.ts#L26)
- `POST /api/hcm/capabilities` — [source](../../src/app/api/hcm/capabilities/route.ts#L103)
- `GET /api/hcm/effective-changes` — [source](../../src/app/api/hcm/effective-changes/route.ts#L86)
- `PATCH /api/hcm/effective-changes` — [source](../../src/app/api/hcm/effective-changes/route.ts#L476)
- `POST /api/hcm/effective-changes` — [source](../../src/app/api/hcm/effective-changes/route.ts#L115)
- `GET /api/hcm/employment-term-decisions` — [source](../../src/app/api/hcm/employment-term-decisions/route.ts#L51)
- `PATCH /api/hcm/employment-term-decisions` — [source](../../src/app/api/hcm/employment-term-decisions/route.ts#L268)
- `POST /api/hcm/employment-term-decisions` — [source](../../src/app/api/hcm/employment-term-decisions/route.ts#L77)
- `GET /api/hcm/employment-term-decisions/[id]/manager-attestation` — [source](../../src/app/api/hcm/employment-term-decisions/[id]/manager-attestation/route.ts#L57)
- `POST /api/hcm/employment-term-decisions/[id]/manager-attestation` — [source](../../src/app/api/hcm/employment-term-decisions/[id]/manager-attestation/route.ts#L90)
- `GET /api/hcm/employment-terms` — [source](../../src/app/api/hcm/employment-terms/route.ts#L46)
- `PATCH /api/hcm/employment-terms` — [source](../../src/app/api/hcm/employment-terms/route.ts#L198)
- `POST /api/hcm/employment-terms` — [source](../../src/app/api/hcm/employment-terms/route.ts#L86)
- `GET /api/hcm/engagement-surveys` — [source](../../src/app/api/hcm/engagement-surveys/route.ts#L32)
- `POST /api/hcm/engagement-surveys` — [source](../../src/app/api/hcm/engagement-surveys/route.ts#L72)
- `GET /api/hcm/lifecycle-policy` — [source](../../src/app/api/hcm/lifecycle-policy/route.ts#L46)
- `PATCH /api/hcm/lifecycle-policy` — [source](../../src/app/api/hcm/lifecycle-policy/route.ts#L79)
- `GET /api/hcm/lifecycle-readiness` — [source](../../src/app/api/hcm/lifecycle-readiness/route.ts#L9)
- `GET /api/hcm/manager-decision-inbox` — [source](../../src/app/api/hcm/manager-decision-inbox/route.ts#L27)
- `GET /api/hcm/my-team` — [source](../../src/app/api/hcm/my-team/route.ts#L26)
- `GET /api/hcm/org-explorer` — [source](../../src/app/api/hcm/org-explorer/route.ts#L11)
- `GET /api/hcm/people-operations-inbox` — [source](../../src/app/api/hcm/people-operations-inbox/route.ts#L19)
- `GET /api/hcm/position-history` — [source](../../src/app/api/hcm/position-history/route.ts#L11)
- `GET /api/hcm/probation-reviews` — [source](../../src/app/api/hcm/probation-reviews/route.ts#L126)
- `PATCH /api/hcm/probation-reviews` — [source](../../src/app/api/hcm/probation-reviews/route.ts#L236)
- `POST /api/hcm/probation-reviews` — [source](../../src/app/api/hcm/probation-reviews/route.ts#L158)
- `GET /api/hcm/process-monitor` — [source](../../src/app/api/hcm/process-monitor/route.ts#L20)
- `POST /api/hcm/salary-corrections/preview` — [source](../../src/app/api/hcm/salary-corrections/preview/route.ts#L24)
- `GET /api/hcm/team-leave-calendar` — [source](../../src/app/api/hcm/team-leave-calendar/route.ts#L23)
- `GET /api/hcm/work-items` — [source](../../src/app/api/hcm/work-items/route.ts#L24)
- `PATCH /api/hcm/work-items` — [source](../../src/app/api/hcm/work-items/route.ts#L48)
- `POST /api/hcm/work-items/escalate` — [source](../../src/app/api/hcm/work-items/escalate/route.ts#L16)
- `GET /api/hcm/work-items/events` — [source](../../src/app/api/hcm/work-items/events/route.ts#L8)
- `GET /api/hcm/worker-360` — [source](../../src/app/api/hcm/worker-360/route.ts#L25)
- `GET /api/hcm/worker-profile` — [source](../../src/app/api/hcm/worker-profile/route.ts#L66)
- `GET /api/employee-identifier-requests` — [source](../../src/app/api/employee-identifier-requests/route.ts#L31)
- `POST /api/employee-identifier-requests` — [source](../../src/app/api/employee-identifier-requests/route.ts#L86)

### Batch PII-02 — Employees, recruitment, discipline and self-service records (38 methods; phase 4)

**Shared fixture:** real employee and applicant, personal identifiers, active worker session, discipline/recruitment case. **Status (proposed from main@dd890dd65f14):** 26 COVERED / 0 PUBLIC-BY-DESIGN / 12 GAP across 38 frozen methods; **BATCH INCOMPLETE**. Remaining listed GAP: `GET /api/careers`, `POST /api/careers`, `PATCH /api/careers/admin`, `PATCH /api/employees`, `POST /api/employees`, `PATCH /api/employees/[id]/mwe-classifications/[classificationId]`, `POST /api/recruitment/hire`, `PATCH /api/recruitment/privacy`, `PATCH /api/self/performance/action-items`, `PATCH /api/self/profile`, `GET /api/self/schedule-receipts`, `POST /api/self/schedule-receipts`.

- `GET /api/careers` — [source](../../src/app/api/careers/route.ts#L26)
- `POST /api/careers` — [source](../../src/app/api/careers/route.ts#L51)
- `PATCH /api/careers/admin` — [source](../../src/app/api/careers/admin/route.ts#L14)
- `GET /api/discipline` — [source](../../src/app/api/discipline/route.ts#L11)
- `PATCH /api/discipline` — [source](../../src/app/api/discipline/route.ts#L112)
- `POST /api/discipline` — [source](../../src/app/api/discipline/route.ts#L52)
- `PATCH /api/employees` — [source](../../src/app/api/employees/route.ts#L410)
- `POST /api/employees` — [source](../../src/app/api/employees/route.ts#L116)
- `GET /api/employees/[id]/mwe-classifications` — [source](../../src/app/api/employees/[id]/mwe-classifications/route.ts#L23)
- `POST /api/employees/[id]/mwe-classifications` — [source](../../src/app/api/employees/[id]/mwe-classifications/route.ts#L58)
- `PATCH /api/employees/[id]/mwe-classifications/[classificationId]` — [source](../../src/app/api/employees/[id]/mwe-classifications/[classificationId]/route.ts#L18)
- `GET /api/recruitment` — [source](../../src/app/api/recruitment/route.ts#L60)
- `PATCH /api/recruitment` — [source](../../src/app/api/recruitment/route.ts#L581)
- `POST /api/recruitment` — [source](../../src/app/api/recruitment/route.ts#L163)
- `POST /api/recruitment/hire` — [source](../../src/app/api/recruitment/hire/route.ts#L53)
- `GET /api/recruitment/privacy` — [source](../../src/app/api/recruitment/privacy/route.ts#L30)
- `PATCH /api/recruitment/privacy` — [source](../../src/app/api/recruitment/privacy/route.ts#L81)
- `GET /api/self/availability` — [source](../../src/app/api/self/availability/route.ts#L54)
- `POST /api/self/availability` — [source](../../src/app/api/self/availability/route.ts#L101)
- `GET /api/self/contribution-issues` — [source](../../src/app/api/self/contribution-issues/route.ts#L52)
- `POST /api/self/contribution-issues` — [source](../../src/app/api/self/contribution-issues/route.ts#L104)
- `GET /api/self/identifiers` — [source](../../src/app/api/self/identifiers/route.ts#L38)
- `POST /api/self/identifiers` — [source](../../src/app/api/self/identifiers/route.ts#L81)
- `GET /api/self/performance` — [source](../../src/app/api/self/performance/route.ts#L47)
- `PATCH /api/self/performance` — [source](../../src/app/api/self/performance/route.ts#L226)
- `POST /api/self/performance` — [source](../../src/app/api/self/performance/route.ts#L167)
- `PATCH /api/self/performance/action-items` — [source](../../src/app/api/self/performance/action-items/route.ts#L48)
- `GET /api/self/performance/development-plans` — [source](../../src/app/api/self/performance/development-plans/route.ts#L36)
- `PATCH /api/self/performance/development-plans` — [source](../../src/app/api/self/performance/development-plans/route.ts#L139)
- `POST /api/self/performance/development-plans` — [source](../../src/app/api/self/performance/development-plans/route.ts#L77)
- `GET /api/self/probation-reviews` — [source](../../src/app/api/self/probation-reviews/route.ts#L45)
- `POST /api/self/probation-reviews` — [source](../../src/app/api/self/probation-reviews/route.ts#L73)
- `PATCH /api/self/profile` — [source](../../src/app/api/self/profile/route.ts#L18)
- `GET /api/self/schedule-receipts` — [source](../../src/app/api/self/schedule-receipts/route.ts#L35)
- `POST /api/self/schedule-receipts` — [source](../../src/app/api/self/schedule-receipts/route.ts#L44)
- `GET /api/self/take-home-estimate` — [source](../../src/app/api/self/take-home-estimate/route.ts#L16)
- `GET /api/self/workforce` — [source](../../src/app/api/self/workforce/route.ts#L81)
- `POST /api/self/workforce` — [source](../../src/app/api/self/workforce/route.ts#L140)

### Batch WRK-01 — Workforce time, attendance, schedules and work sites (39 methods; phase 5)

**Shared fixture:** worker, timesheet, worksite, schedule, approval and attendance events. **Status (live manifest at main@a7dc1f5184f5):** 19 COVERED / 0 PUBLIC-BY-DESIGN / 20 GAP across 39 frozen methods; **BATCH INCOMPLETE**. Remaining listed GAP: `POST /api/workforce/attendance-corrections`, `POST /api/workforce/coverage`, `GET /api/workforce/demand-observations/issued`, `POST /api/workforce/demand-observations/issued`, `POST /api/workforce/demand-observations/issued/score`, `GET /api/workforce/demand-observations/loyverse`, `POST /api/workforce/demand-observations/loyverse`, `GET /api/workforce/demand-observations/square-sandbox`, `POST /api/workforce/demand-observations/square-sandbox`, `GET /api/workforce/demand-staffing/policies`, `PATCH /api/workforce/demand-staffing/policies`, `POST /api/workforce/demand-staffing/policies`, `GET /api/workforce/greedy-roster`, `POST /api/workforce/overtime`, `POST /api/workforce/roster-batches`, `POST /api/workforce/roster-rules/preview`, `POST /api/workforce/schedule-swaps`, `POST /api/workforce/schedules`, `POST /api/workforce/timesheets`, `POST /api/workforce/worksites`.

- `GET /api/workforce/attendance-corrections` — [source](../../src/app/api/workforce/attendance-corrections/route.ts#L81)
- `POST /api/workforce/attendance-corrections` — [source](../../src/app/api/workforce/attendance-corrections/route.ts#L136)
- `GET /api/workforce/coverage` — [source](../../src/app/api/workforce/coverage/route.ts#L788)
- `POST /api/workforce/coverage` — [source](../../src/app/api/workforce/coverage/route.ts#L1369)
- `GET /api/workforce/demand-observations/issued` — [source](../../src/app/api/workforce/demand-observations/issued/route.ts#L32)
- `POST /api/workforce/demand-observations/issued` — [source](../../src/app/api/workforce/demand-observations/issued/route.ts#L61)
- `POST /api/workforce/demand-observations/issued/score` — [source](../../src/app/api/workforce/demand-observations/issued/score/route.ts#L20)
- `GET /api/workforce/demand-observations/loyverse` — [source](../../src/app/api/workforce/demand-observations/loyverse/route.ts#L43)
- `POST /api/workforce/demand-observations/loyverse` — [source](../../src/app/api/workforce/demand-observations/loyverse/route.ts#L113)
- `GET /api/workforce/demand-observations/outlook` — [source](../../src/app/api/workforce/demand-observations/outlook/route.ts#L16)
- `GET /api/workforce/demand-observations/square-sandbox` — [source](../../src/app/api/workforce/demand-observations/square-sandbox/route.ts#L39)
- `POST /api/workforce/demand-observations/square-sandbox` — [source](../../src/app/api/workforce/demand-observations/square-sandbox/route.ts#L100)
- `GET /api/workforce/demand-outlook` — [source](../../src/app/api/workforce/demand-outlook/route.ts#L18)
- `GET /api/workforce/demand-staffing/policies` — [source](../../src/app/api/workforce/demand-staffing/policies/route.ts#L39)
- `PATCH /api/workforce/demand-staffing/policies` — [source](../../src/app/api/workforce/demand-staffing/policies/route.ts#L125)
- `POST /api/workforce/demand-staffing/policies` — [source](../../src/app/api/workforce/demand-staffing/policies/route.ts#L89)
- `GET /api/workforce/greedy-roster` — [source](../../src/app/api/workforce/greedy-roster/route.ts#L17)
- `GET /api/workforce/labor-costing` — [source](../../src/app/api/workforce/labor-costing/route.ts#L78)
- `POST /api/workforce/labor-costing` — [source](../../src/app/api/workforce/labor-costing/route.ts#L133)
- `GET /api/workforce/live-floor` — [source](../../src/app/api/workforce/live-floor/route.ts#L34)
- `GET /api/workforce/overtime` — [source](../../src/app/api/workforce/overtime/route.ts#L230)
- `POST /api/workforce/overtime` — [source](../../src/app/api/workforce/overtime/route.ts#L319)
- `GET /api/workforce/roster-batches` — [source](../../src/app/api/workforce/roster-batches/route.ts#L42)
- `POST /api/workforce/roster-batches` — [source](../../src/app/api/workforce/roster-batches/route.ts#L94)
- `GET /api/workforce/roster-rules` — [source](../../src/app/api/workforce/roster-rules/route.ts#L13)
- `POST /api/workforce/roster-rules` — [source](../../src/app/api/workforce/roster-rules/route.ts#L28)
- `POST /api/workforce/roster-rules/preview` — [source](../../src/app/api/workforce/roster-rules/preview/route.ts#L14)
- `GET /api/workforce/schedule-guardrails` — [source](../../src/app/api/workforce/schedule-guardrails/route.ts#L33)
- `POST /api/workforce/schedule-guardrails` — [source](../../src/app/api/workforce/schedule-guardrails/route.ts#L62)
- `GET /api/workforce/schedule-receipt-review` — [source](../../src/app/api/workforce/schedule-receipt-review/route.ts#L19)
- `GET /api/workforce/schedule-swaps` — [source](../../src/app/api/workforce/schedule-swaps/route.ts#L229)
- `POST /api/workforce/schedule-swaps` — [source](../../src/app/api/workforce/schedule-swaps/route.ts#L274)
- `GET /api/workforce/schedules` — [source](../../src/app/api/workforce/schedules/route.ts#L152)
- `POST /api/workforce/schedules` — [source](../../src/app/api/workforce/schedules/route.ts#L359)
- `GET /api/workforce/team-roster` — [source](../../src/app/api/workforce/team-roster/route.ts#L39)
- `GET /api/workforce/timesheets` — [source](../../src/app/api/workforce/timesheets/route.ts#L54)
- `POST /api/workforce/timesheets` — [source](../../src/app/api/workforce/timesheets/route.ts#L122)
- `GET /api/workforce/worksites` — [source](../../src/app/api/workforce/worksites/route.ts#L114)
- `POST /api/workforce/worksites` — [source](../../src/app/api/workforce/worksites/route.ts#L198)

### Batch WRK-02 — Performance and workforce planning (39 methods; phase 5)

**Shared fixture:** owned performance review, objective, forecast, position and allocations. **Status (live manifest at main@a7dc1f5184f5):** 23 COVERED / 0 PUBLIC-BY-DESIGN / 16 GAP across 39 frozen methods; **BATCH INCOMPLETE**. Remaining listed GAP: `PATCH /api/performance`, `POST /api/performance`, `PATCH /api/performance/calibration`, `PATCH /api/performance/follow-through-governance`, `PATCH /api/workforce-planning`, `POST /api/workforce-planning`, `PATCH /api/workforce-planning/allocations`, `POST /api/workforce-planning/allocations`, `POST /api/workforce-planning/baselines`, `POST /api/workforce-planning/demand-handoff`, `POST /api/workforce-planning/forecast-plan`, `PATCH /api/workforce-planning/position-executions`, `POST /api/workforce-planning/position-executions`, `PATCH /api/workforce-planning/scenarios`, `POST /api/workforce-planning/scenarios`, `POST /api/workforce-planning/transfer`.

- `GET /api/performance` — [source](../../src/app/api/performance/route.ts#L316)
- `PATCH /api/performance` — [source](../../src/app/api/performance/route.ts#L752)
- `POST /api/performance` — [source](../../src/app/api/performance/route.ts#L403)
- `PATCH /api/performance/action-items` — [source](../../src/app/api/performance/action-items/route.ts#L250)
- `POST /api/performance/action-items` — [source](../../src/app/api/performance/action-items/route.ts#L167)
- `GET /api/performance/analytics` — [source](../../src/app/api/performance/analytics/route.ts#L43)
- `GET /api/performance/calibration` — [source](../../src/app/api/performance/calibration/route.ts#L50)
- `PATCH /api/performance/calibration` — [source](../../src/app/api/performance/calibration/route.ts#L188)
- `POST /api/performance/calibration` — [source](../../src/app/api/performance/calibration/route.ts#L94)
- `GET /api/performance/competencies` — [source](../../src/app/api/performance/competencies/route.ts#L50)
- `PATCH /api/performance/competencies` — [source](../../src/app/api/performance/competencies/route.ts#L358)
- `POST /api/performance/competencies` — [source](../../src/app/api/performance/competencies/route.ts#L176)
- `GET /api/performance/continuous` — [source](../../src/app/api/performance/continuous/route.ts#L67)
- `PATCH /api/performance/continuous` — [source](../../src/app/api/performance/continuous/route.ts#L288)
- `POST /api/performance/continuous` — [source](../../src/app/api/performance/continuous/route.ts#L164)
- `GET /api/performance/development-plans` — [source](../../src/app/api/performance/development-plans/route.ts#L165)
- `PATCH /api/performance/development-plans` — [source](../../src/app/api/performance/development-plans/route.ts#L379)
- `POST /api/performance/development-plans` — [source](../../src/app/api/performance/development-plans/route.ts#L221)
- `GET /api/performance/follow-through-governance` — [source](../../src/app/api/performance/follow-through-governance/route.ts#L71)
- `PATCH /api/performance/follow-through-governance` — [source](../../src/app/api/performance/follow-through-governance/route.ts#L116)
- `GET /api/performance/talent-continuity` — [source](../../src/app/api/performance/talent-continuity/route.ts#L30)
- `GET /api/workforce-planning` — [source](../../src/app/api/workforce-planning/route.ts#L75)
- `PATCH /api/workforce-planning` — [source](../../src/app/api/workforce-planning/route.ts#L779)
- `POST /api/workforce-planning` — [source](../../src/app/api/workforce-planning/route.ts#L175)
- `GET /api/workforce-planning/allocations` — [source](../../src/app/api/workforce-planning/allocations/route.ts#L72)
- `PATCH /api/workforce-planning/allocations` — [source](../../src/app/api/workforce-planning/allocations/route.ts#L418)
- `POST /api/workforce-planning/allocations` — [source](../../src/app/api/workforce-planning/allocations/route.ts#L145)
- `GET /api/workforce-planning/baselines` — [source](../../src/app/api/workforce-planning/baselines/route.ts#L145)
- `POST /api/workforce-planning/baselines` — [source](../../src/app/api/workforce-planning/baselines/route.ts#L259)
- `POST /api/workforce-planning/demand-handoff` — [source](../../src/app/api/workforce-planning/demand-handoff/route.ts#L33)
- `GET /api/workforce-planning/forecast` — [source](../../src/app/api/workforce-planning/forecast/route.ts#L25)
- `POST /api/workforce-planning/forecast-plan` — [source](../../src/app/api/workforce-planning/forecast-plan/route.ts#L85)
- `GET /api/workforce-planning/position-executions` — [source](../../src/app/api/workforce-planning/position-executions/route.ts#L145)
- `PATCH /api/workforce-planning/position-executions` — [source](../../src/app/api/workforce-planning/position-executions/route.ts#L318)
- `POST /api/workforce-planning/position-executions` — [source](../../src/app/api/workforce-planning/position-executions/route.ts#L184)
- `GET /api/workforce-planning/scenarios` — [source](../../src/app/api/workforce-planning/scenarios/route.ts#L91)
- `PATCH /api/workforce-planning/scenarios` — [source](../../src/app/api/workforce-planning/scenarios/route.ts#L356)
- `POST /api/workforce-planning/scenarios` — [source](../../src/app/api/workforce-planning/scenarios/route.ts#L195)
- `POST /api/workforce-planning/transfer` — [source](../../src/app/api/workforce-planning/transfer/route.ts#L23)

### Batch WRK-03 — Multi-entity, benefits, leave, holidays and Web Bundy (40 methods; phase 5)

**Shared fixture:** unit/legal entity, attendance evidence, benefits, holiday, leave and delegated manager permissions. **Status (live manifest at main@a7dc1f5184f5):** 29 COVERED / 0 PUBLIC-BY-DESIGN / 11 GAP across 40 frozen methods; **BATCH INCOMPLETE**. Remaining listed GAP: `PUT /api/benefits`, `POST /api/benefits/hmo`, `POST /api/biometrics/sync`, `POST /api/leave`, `POST /api/leave/conversion`, `PATCH /api/multi-entity/transfers`, `POST /api/multi-entity/transfers`, `POST /api/web-bundy`, `POST /api/web-bundy/consent`, `GET /api/web-bundy/review`, `POST /api/web-bundy/review`.

- `GET /api/attendance/offline-claims` — [source](../../src/app/api/attendance/offline-claims/route.ts#L22)
- `PATCH /api/attendance/offline-claims` — [source](../../src/app/api/attendance/offline-claims/route.ts#L140)
- `POST /api/attendance/offline-claims` — [source](../../src/app/api/attendance/offline-claims/route.ts#L67)
- `DELETE /api/benefits` — [source](../../src/app/api/benefits/route.ts#L147)
- `GET /api/benefits` — [source](../../src/app/api/benefits/route.ts#L13)
- `POST /api/benefits` — [source](../../src/app/api/benefits/route.ts#L60)
- `PUT /api/benefits` — [source](../../src/app/api/benefits/route.ts#L208)
- `GET /api/benefits/hmo` — [source](../../src/app/api/benefits/hmo/route.ts#L33)
- `POST /api/benefits/hmo` — [source](../../src/app/api/benefits/hmo/route.ts#L117)
- `GET /api/biometrics/sync` — [source](../../src/app/api/biometrics/sync/route.ts#L16)
- `POST /api/biometrics/sync` — [source](../../src/app/api/biometrics/sync/route.ts#L53)
- `GET /api/delegations` — [source](../../src/app/api/delegations/route.ts#L19)
- `PATCH /api/delegations` — [source](../../src/app/api/delegations/route.ts#L139)
- `POST /api/delegations` — [source](../../src/app/api/delegations/route.ts#L58)
- `GET /api/dynamic-worker-groups` — [source](../../src/app/api/dynamic-worker-groups/route.ts#L143)
- `POST /api/dynamic-worker-groups` — [source](../../src/app/api/dynamic-worker-groups/route.ts#L213)
- `DELETE /api/holidays` — [source](../../src/app/api/holidays/route.ts#L422)
- `GET /api/holidays` — [source](../../src/app/api/holidays/route.ts#L129)
- `PATCH /api/holidays` — [source](../../src/app/api/holidays/route.ts#L296)
- `POST /api/holidays` — [source](../../src/app/api/holidays/route.ts#L191)
- `GET /api/leave` — [source](../../src/app/api/leave/route.ts#L136)
- `POST /api/leave` — [source](../../src/app/api/leave/route.ts#L205)
- `GET /api/leave/conversion` — [source](../../src/app/api/leave/conversion/route.ts#L11)
- `POST /api/leave/conversion` — [source](../../src/app/api/leave/conversion/route.ts#L52)
- `POST /api/leave/preview` — [source](../../src/app/api/leave/preview/route.ts#L23)
- `GET /api/multi-entity/context` — [source](../../src/app/api/multi-entity/context/route.ts#L13)
- `PATCH /api/multi-entity/context` — [source](../../src/app/api/multi-entity/context/route.ts#L25)
- `GET /api/multi-entity/registration-changes` — [source](../../src/app/api/multi-entity/registration-changes/route.ts#L43)
- `PATCH /api/multi-entity/registration-changes` — [source](../../src/app/api/multi-entity/registration-changes/route.ts#L160)
- `POST /api/multi-entity/registration-changes` — [source](../../src/app/api/multi-entity/registration-changes/route.ts#L90)
- `GET /api/multi-entity/settings` — [source](../../src/app/api/multi-entity/settings/route.ts#L35)
- `PATCH /api/multi-entity/settings` — [source](../../src/app/api/multi-entity/settings/route.ts#L64)
- `GET /api/multi-entity/transfers` — [source](../../src/app/api/multi-entity/transfers/route.ts#L40)
- `PATCH /api/multi-entity/transfers` — [source](../../src/app/api/multi-entity/transfers/route.ts#L248)
- `POST /api/multi-entity/transfers` — [source](../../src/app/api/multi-entity/transfers/route.ts#L89)
- `GET /api/web-bundy` — [source](../../src/app/api/web-bundy/route.ts#L40)
- `POST /api/web-bundy` — [source](../../src/app/api/web-bundy/route.ts#L127)
- `POST /api/web-bundy/consent` — [source](../../src/app/api/web-bundy/consent/route.ts#L16)
- `GET /api/web-bundy/review` — [source](../../src/app/api/web-bundy/review/route.ts#L39)
- `POST /api/web-bundy/review` — [source](../../src/app/api/web-bundy/review/route.ts#L83)

### Batch EDG-01 — Authentication, account, onboarding and readiness (33 methods; phase 6)

**Shared fixture:** distinct signed-in identities, scoped token/setup links; public-only decisions require per-method owner review. **Status (live manifest at main@a7dc1f5184f5):** 3 COVERED / 0 PUBLIC-BY-DESIGN / 30 GAP across 33 frozen methods; **BATCH INCOMPLETE**. Remaining listed GAP: `POST /api/account/email`, `POST /api/account/email/verify`, `POST /api/account/password`, `POST /api/auth/logout`, `POST /api/auth/saml/acs/[providerId]`, `GET /api/auth/saml/metadata/[providerId]`, `GET /api/auth/saml/start/[providerId]`, `GET /api/auth/sso/callback`, `POST /api/auth/sso/resolve`, `GET /api/auth/sso/start`, `GET /api/auth/totp/setup`, `POST /api/auth/totp/setup`, `POST /api/invitations`, `GET /api/invitations/accept`, `POST /api/invitations/accept`, `POST /api/signup`, `POST /api/signup/resend`, `POST /api/signup/verify`, `GET /api/readiness`, `GET /api/readiness/billing`, `GET /api/readiness/database-target`, `GET /api/readiness/deployment`, `GET /api/readiness/pilot-status`, `GET /api/readiness/workspace`, `POST /api/demo-requests`, `GET /api/marketing/leads`, `POST /api/intake-challenge`, `GET /api/setup`, `POST /api/setup`, `GET /api/capabilities`.

- `GET /api/account` — [source](../../src/app/api/account/route.ts#L14)
- `POST /api/account/email` — [source](../../src/app/api/account/email/route.ts#L22)
- `POST /api/account/email/verify` — [source](../../src/app/api/account/email/verify/route.ts#L13)
- `POST /api/account/password` — [source](../../src/app/api/account/password/route.ts#L29)
- `POST /api/auth/logout` — [source](../../src/app/api/auth/logout/route.ts#L5)
- `GET /api/auth/me` — [source](../../src/app/api/auth/me/route.ts#L6)
- `POST /api/auth/saml/acs/[providerId]` — [source](../../src/app/api/auth/saml/acs/[providerId]/route.ts#L8)
- `GET /api/auth/saml/metadata/[providerId]` — [source](../../src/app/api/auth/saml/metadata/[providerId]/route.ts#L9)
- `GET /api/auth/saml/start/[providerId]` — [source](../../src/app/api/auth/saml/start/[providerId]/route.ts#L8)
- `GET /api/auth/sso/callback` — [source](../../src/app/api/auth/sso/callback/route.ts#L23)
- `POST /api/auth/sso/resolve` — [source](../../src/app/api/auth/sso/resolve/route.ts#L9)
- `GET /api/auth/sso/start` — [source](../../src/app/api/auth/sso/start/route.ts#L11)
- `GET /api/auth/totp/setup` — [source](../../src/app/api/auth/totp/setup/route.ts#L18)
- `POST /api/auth/totp/setup` — [source](../../src/app/api/auth/totp/setup/route.ts#L32)
- `GET /api/invitations` — [source](../../src/app/api/invitations/route.ts#L17)
- `POST /api/invitations` — [source](../../src/app/api/invitations/route.ts#L60)
- `GET /api/invitations/accept` — [source](../../src/app/api/invitations/accept/route.ts#L15)
- `POST /api/invitations/accept` — [source](../../src/app/api/invitations/accept/route.ts#L23)
- `POST /api/signup` — [source](../../src/app/api/signup/route.ts#L21)
- `POST /api/signup/resend` — [source](../../src/app/api/signup/resend/route.ts#L14)
- `POST /api/signup/verify` — [source](../../src/app/api/signup/verify/route.ts#L14)
- `GET /api/readiness` — [source](../../src/app/api/readiness/route.ts#L7)
- `GET /api/readiness/billing` — [source](../../src/app/api/readiness/billing/route.ts#L15)
- `GET /api/readiness/database-target` — [source](../../src/app/api/readiness/database-target/route.ts#L11)
- `GET /api/readiness/deployment` — [source](../../src/app/api/readiness/deployment/route.ts#L9)
- `GET /api/readiness/pilot-status` — [source](../../src/app/api/readiness/pilot-status/route.ts#L28)
- `GET /api/readiness/workspace` — [source](../../src/app/api/readiness/workspace/route.ts#L7)
- `POST /api/demo-requests` — [source](../../src/app/api/demo-requests/route.ts#L18)
- `GET /api/marketing/leads` — [source](../../src/app/api/marketing/leads/route.ts#L16)
- `POST /api/intake-challenge` — [source](../../src/app/api/intake-challenge/route.ts#L8)
- `GET /api/setup` — [source](../../src/app/api/setup/route.ts#L21)
- `POST /api/setup` — [source](../../src/app/api/setup/route.ts#L28)
- `GET /api/capabilities` — [source](../../src/app/api/capabilities/route.ts#L7)

### Batch EDG-02 — Webhooks, jobs, provisioning and infrastructure integrations (33 methods; phase 6)

**Shared fixture:** dummy signatures, replay check, tenant bound events, signed service sessions and no external provider calls. **Status (live manifest at main@a7dc1f5184f5):** 17 COVERED / 0 PUBLIC-BY-DESIGN / 16 GAP across 33 frozen methods; **BATCH INCOMPLETE**. Remaining listed GAP: `POST /api/automation-studio`, `POST /api/developer`, `POST /api/enterprise`, `POST /api/governed-handoffs`, `GET /api/jobs/cron`, `GET /api/jobs/dispatch-readiness`, `GET /api/jobs/status`, `POST /api/jobs/tick`, `POST /api/migrations`, `POST /api/outbox`, `GET /api/v1`, `POST /api/webhooks/drain`, `POST /api/webhooks/paymongo/transfers`, `POST /api/webhooks/resend`, `POST /api/webhooks/xendit-payout`, `POST /api/webhooks/xendit/subscriptions`.

- `GET /api/automation-studio` — [source](../../src/app/api/automation-studio/route.ts#L211)
- `POST /api/automation-studio` — [source](../../src/app/api/automation-studio/route.ts#L563)
- `GET /api/developer` — [source](../../src/app/api/developer/route.ts#L18)
- `POST /api/developer` — [source](../../src/app/api/developer/route.ts#L63)
- `GET /api/enterprise` — [source](../../src/app/api/enterprise/route.ts#L71)
- `POST /api/enterprise` — [source](../../src/app/api/enterprise/route.ts#L201)
- `GET /api/governed-handoffs` — [source](../../src/app/api/governed-handoffs/route.ts#L59)
- `POST /api/governed-handoffs` — [source](../../src/app/api/governed-handoffs/route.ts#L130)
- `GET /api/integration-connectors` — [source](../../src/app/api/integration-connectors/route.ts#L41)
- `POST /api/integration-connectors` — [source](../../src/app/api/integration-connectors/route.ts#L63)
- `GET /api/it-operations` — [source](../../src/app/api/it-operations/route.ts#L26)
- `PATCH /api/it-operations` — [source](../../src/app/api/it-operations/route.ts#L120)
- `POST /api/it-operations` — [source](../../src/app/api/it-operations/route.ts#L52)
- `GET /api/jobs/cron` — [source](../../src/app/api/jobs/cron/route.ts#L15)
- `GET /api/jobs/dispatch-readiness` — [source](../../src/app/api/jobs/dispatch-readiness/route.ts#L13)
- `GET /api/jobs/status` — [source](../../src/app/api/jobs/status/route.ts#L17)
- `POST /api/jobs/tick` — [source](../../src/app/api/jobs/tick/route.ts#L10)
- `GET /api/migrations` — [source](../../src/app/api/migrations/route.ts#L61)
- `POST /api/migrations` — [source](../../src/app/api/migrations/route.ts#L107)
- `PUT /api/organizations` — [source](../../src/app/api/organizations/route.ts#L15)
- `GET /api/outbox` — [source](../../src/app/api/outbox/route.ts#L20)
- `POST /api/outbox` — [source](../../src/app/api/outbox/route.ts#L89)
- `GET /api/provisioning` — [source](../../src/app/api/provisioning/route.ts#L13)
- `PATCH /api/provisioning` — [source](../../src/app/api/provisioning/route.ts#L50)
- `GET /api/tenant-modules` — [source](../../src/app/api/tenant-modules/route.ts#L25)
- `PATCH /api/tenant-modules` — [source](../../src/app/api/tenant-modules/route.ts#L32)
- `GET /api/v1` — [source](../../src/app/api/v1/route.ts#L6)
- `GET /api/v1/journal-entries` — [source](../../src/app/api/v1/journal-entries/route.ts#L10)
- `POST /api/webhooks/drain` — [source](../../src/app/api/webhooks/drain/route.ts#L14)
- `POST /api/webhooks/paymongo/transfers` — [source](../../src/app/api/webhooks/paymongo/transfers/route.ts#L48)
- `POST /api/webhooks/resend` — [source](../../src/app/api/webhooks/resend/route.ts#L10)
- `POST /api/webhooks/xendit-payout` — [source](../../src/app/api/webhooks/xendit-payout/route.ts#L16)
- `POST /api/webhooks/xendit/subscriptions` — [source](../../src/app/api/webhooks/xendit/subscriptions/route.ts#L31)

## Page and server-action closure (20 independently requested wrong-employer surfaces)

For every page below, seed an authorized **nonempty own-employer page** (or published-only data for the public careers route), request it with a real authenticated own principal (or an actual anonymous caller for a justified public page), then request the victim organization/employee ID with that **same attacker identity**. Assert the exact HTTP status/redirect plus **absence of real victim content** in server-rendered HTML/RSC payloads and data on any invoked server action. For actions, submit a real POST/RSC action request under the wrong employer and compare the real victim DB rows before/after. A feature-disabled 404 or a redirect to login alone is not proof. Reuse `tenant-scoped-page-probes.mjs` as exploratory input only; promote page status after independent HTTP evidence.

- `GET /app/engagement` — `src/app/app/engagement/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /app/goals-reviews` — `src/app/app/goals-reviews/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /app` — `src/app/app/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /billing/setup` — `src/app/billing/setup/page.tsx`; fixture: owner and victim billing org; state: GAP; linked evidence: none
- `GET /careers` — `src/app/careers/page.tsx`; fixture: published vacancy and private victim requisition; state: GAP; linked evidence: none
- `GET /hcm/action-center` — `src/app/hcm/action-center/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/command-center` — `src/app/hcm/command-center/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/hire-payroll-review` — `src/app/hcm/hire-payroll-review/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/hr-cases` — `src/app/hcm/hr-cases/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/manager-decision-inbox` — `src/app/hcm/manager-decision-inbox/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/my-team` — `src/app/hcm/my-team/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/org-explorer` — `src/app/hcm/org-explorer/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/process-monitor` — `src/app/hcm/process-monitor/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/team-leave-calendar` — `src/app/hcm/team-leave-calendar/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/work-items` — `src/app/hcm/work-items/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /hcm/worker-360` — `src/app/hcm/worker-360/page.tsx`; fixture: owner/manager and real victim org data; state: GAP; linked evidence: none
- `GET /self/schedule-receipts` — `src/app/self/schedule-receipts/page.tsx`; fixture: signed-in employee and victim employee; state: GAP; linked evidence: none
- `GET /workspace/2316` — `src/app/workspace/2316/page.tsx`; fixture: owner and victim statutory data; state: GAP; linked evidence: none
- `GET /workspace/prior-employer` — `src/app/workspace/prior-employer/page.tsx`; fixture: owner and victim statutory data; state: GAP; linked evidence: none
- `GET /workspace/report-builder` — `src/app/workspace/report-builder/page.tsx`; fixture: owner and victim statutory data; state: GAP; linked evidence: none

## CI and proof-link closure guards (incremental, never relaxed)

- Retain [second-pass runner](../../scripts/qa/tenant-second-pass-http.mjs), [route registry](../../scripts/qa/tenant-second-pass-manifest.mjs), [manifest-driven HTTP](../../scripts/qa/tenant-manifest-driven-http.mjs), [high-risk HTTP](../../scripts/qa/tenant-high-risk-01-http.mjs), [bank evidence HTTP](../../scripts/qa/bank-tenant-http.mjs), [delegated source tracer](../../scripts/qa/tenant-delegated-trace.mjs), [page probes](../../scripts/qa/tenant-scoped-page-probes.mjs), [coverage inventory unit test](../../tests/tenant-isolation-coverage-inventory.test.mjs), [security workflow](../../.github/workflows/security-http-smoke.yml), and [second-pass notes](../qa/tenant-second-pass.md). Extend instead of replacing them. Preserve strict exit-on-error and fail-closed guards.
- New exported methods must have exactly one manifest record; unknown/new/modified handlers fail CI. **No manifest absence or method-status omission is a pass.** Public-by-design must have a reviewed method-specific reason proving no other-tenant private resource can be read or mutated. Implement `NEEDS OWNER` only with an actionable question, specific surface, owner assignee and reason; never silently convert GAP to a waiver.
- For COVERED, CI must resolve the exact linked existing test file/line and require the four components above; normal CI must execute that adapter in isolated real HTTP + PG, not just grep a helper name. To enforce this without falsely validating historical gaps, add proof-line and runtime receipts in each closure PR and re-audit the 76 earlier COVERED entries. Ensure each receipt is tied to method, attacker employer and victim PK. Unproven methods stay GAP.
- Add a programmatic headline counter guard for the consolidated manifest and [inventory overview](tenant-isolation-coverage-inventory.md); count 490 = COVERED + PUBLIC-BY-DESIGN + GAP (+ eventually NEEDS OWNER with question), verify the 20 page entries and the exact 406-method frozen queue. The historical appendices and old audit narratives remain explicitly historical, not current acceptance numbers.
- Run batches in parallel **shards** with isolated disposable PG16 databases and one localhost server per shard, keeping each job below the existing 20-minute budget. No sharing DB fixtures across parallel shards. Keep the default [Security HTTP Smoke](../../.github/workflows/security-http-smoke.yml) and normal `npm test` active on PRs. For each: `npm ci`, `npx tsc --noEmit`, `npm run lint`, `npm test`, Node inventory guards, production-mode security-http-smoke. Collect actual exit status and relevant log excerpts, never substitute expected output.

## Owner decisions / exploit response

If a real HTTP cross-employer leak is reproduced, create a stand-alone security finding with exact fictional IDs, request/response, victim DB before/after, impacted method and reproduction CI SHA. Fix minimally with the existing employer-access helper and same-PR regression. **If it appears exploitable on a live deployment, put that warning in the FIRST line of the PR and stop for owner triage** before rollout or further probing. Do not test live. Owner must decide external-provider-dependent methods where legitimate success cannot occur without provider calls, and any public-by-design auth/webhook route requiring signed-provider end-to-end acceptance. Suggested questions: can an **isolated fully fake provider adapter** prove legitimate success without network or money movement, or should this precise method be marked **NEEDS OWNER** pending approved staging? Is anonymous published careers access public while unpublished victim applications remain tenant-private? What exact redirect/403/404 is intended for each server-rendered page? Record each question per method; unresolved != COVERED.

## Completion criterion

All 490 current exported methods and all 20 page/action entries must resolve to **COVERED with executed four-part proof**, **PUBLIC-BY-DESIGN with an explicit method-level reason**, or **NEEDS OWNER with a concrete owner question**. Every case has a source- and CI-line-pinned evidence record. The manifest must remain **NOT ACCEPTED** until independent reviewer/owner acceptance. As of baseline: **406 API method GAPs and 20 page/action GAPs remain; 0 confirmed live exploits, no new fixes in this planning PR.**

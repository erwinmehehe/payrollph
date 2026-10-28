# Benefits / HMO POST tenant isolation — independent GAP candidate

**Exact manifest method:** `POST benefits/hmo` — currently **GAP**. **No new coverage credit** and **no change to the manifest**.

**History:** started from `main@7dae3c767925820e5cacefa1a4e13758dcb98e1e` and later synchronized with `main@a7dc1f5184f59f3c5ac348e37b4ca88810f10651` in merge commit `a1305025ef6ee16fcecb27f618760db9e6f9cfe9`. The open PRs at selection addressed HCM date hardening, employee development plans, Leave Preview, dashboard date hardening, ESS identifier reviews, API v1 journal, Loans and HCM skills. There was **no open Benefits/HMO PR** and this branch uses independent files.

## Execution boundary

This integrates one new auto-discovered row in the existing **write tenant-table runner**, plus a dedicated focused GitHub Actions job. The only execution environment authorized by the existing runner is an **isolated disposable PostgreSQL 16 app_db on 127.0.0.1**, a production-mode **localhost Next HTTP server**, fictional employers/people, fake cryptographic credentials and **disabled external payouts**. Neither this PR nor the proof writes production HMO, payroll or settlement data.

The runner creates two distinct signed-in fictional employer **owners**, A and B, and a genuine later **higher-ID victim**. This HMO row inserts for each employer an actual persisted HMO plan, enrollment and dependent for the employer's genuine worker. The seed returns real `INSERT ... RETURNING` IDs for all three tables; the victim's IDs are higher than the attacker's IDs and verified by the shared fixture runner.

## Exact POST cases

| Case | Required acceptance evidence |
| --- | --- |
| Owner A/B creates a separate own HMO plan | **201** and exact real PostgreSQL plan ID, organization, category, unique provider/name/plan code, amounts, waiting period and coverage metadata |
| Successful creation audit | Exactly one new **own organization** `HMO plan created` audit row with the actual actor, returned plan ID and provider; old audit rows remain unchanged |
| Owner A/B targets the victim organization with the same plan request | **403**, no victim data leakage, no new plan/audit in either employer |
| Owner A/B uses its own employer plus the victim's **real enrollment ID** with `add_dependent` | **404**, no changes to the victim or own employer |
| Owner A/B uses its own employer plus the victim's **real dependent ID** with `update_dependent` | **404**, no dependent, event, enrollment, audit or plan change |
| Owner A/B uses its own employer plus the victim's real enrollment ID with `update_enrollment` | **404**, no provider status, enrollment, audit or plan change |
| Owner A/B legitimately adds a dependent to its actual enrollment | **201**, one new dependent row with genuine own-company IDs and exact pricing, one `dependent_added` event and one `HMO dependent added` audit |
| Owner A/B legitimately updates that new own dependent | **200**, exact status/member ID persisted, all other dependent fields retained, one `dependent_updated` event and one `HMO dependent updated` audit |
| Owner A/B legitimately updates its actual own enrollment provider state | **200**, `pending_provider` and local member ID/effective date persisted without changing unrelated fields, one `enrollment_updated` event and one `HMO enrollment updated` audit |
| GET after the three legitimate actions | **200** showing the persisted updated own enrollment and active dependent; no victim markers, no read-side mutation |
| HMO GET readback after successful own creation | Own created plan and preseeded plan/enrollment/dependent are visible; victim marker/record cannot appear. GET already has separate inventory status and receives no new credit here |
| Substitute A's actual before/after evidence as B's proof | The independent seed/plan-name/audit validator must reject it; a generic 201 response is insufficient |
| Any unexpected enrollment, dependent, event or old plan changes | Rejected even if the HTTP status is 201 |

State snapshots include **plans, enrollments, dependents, benefit enrollment events and business-content audit events** for each employer. The shared write runner additionally compares organization, employee, unit, legal entity, audit and other victim-source snapshots before and after the pair of signed-in attacks. Both attacker employers must be independently proven.

## Deliberate scope limits

- `POST benefits/hmo` includes four action types. This candidate positively exercises **`create_plan`, `add_dependent`, `update_dependent`, and `update_enrollment`** for both independent owner employers, including exact committed row, event and audit checks. It also tests **stolen-victim-ID denial** for the latter three. It **does not** exercise positive coverage activation/termination event automation, every valid/invalid field combination, non-owner role boundaries, races or genuine provider confirmation. **Full-method coverage credit is held.**
- The seed inserts fictional `active` HMO enrollment and `pending` dependent source records directly. Neither a real HMO enrolment approval nor external provider confirmation is simulated.
- Plan creation changes only the new plan and own audit evidence. Follow-up legitimate dependent/enrollment updates change only the appropriate own HMO source row and produce exact event/audit receipts. The `pending_provider` value is a locally persisted fictional state, **not** an official provider confirmation. The test does not invoke HMO provider APIs, email delivery, live contributions, benefit deductions, remittances or payroll runs.
- The dedicated job runs the shared runner with `TENANT_TABLE_FAMILY=benefits-hmo`, while the standard tenant-table workflow also runs the auto-discovered row in the default profile. Its own dedicated job overrides unrelated worker, scheduler, Xendit billing and overpayment flags to `false` without changing production settings or the shared profile. Other jobs and profiles are unchanged.

## Scope repair following successful historical CI

The earlier HMO, shared tenant-table and vault checks passed at `a1305025ef6ee16fcecb27f618760db9e6f9cfe9` for their available jobs. No new failure was observed in those checks. Review identified a **coverage gap**, not a proven production vulnerability: genuine `add_dependent`, `update_dependent`, and `update_enrollment` successes were not exercised, only stolen-ID refusals. This revision adds **six real own-HMO successful mutations** (three per signed-in owner) to the existing focused and shared HTTP row, plus one new adversarial source test rejecting fake HTTP 201 without a committed dependent and audit. The historical passes **do not validate the updated head**; obtain fresh exact-head receipts.

## Required exact-head gates

- [ ] Syntax checks and all **nine** adversarial Node source tests actually pass on the **updated** PR head.
- [ ] Dedicated **HMO benefits tenant HTTP (fictional PostgreSQL 16 only)** job completes on the **updated** head with both authenticated owners, three additional real positive HMO mutations per actor, exact audit/event receipts, real victim rows, readback, 403/404 denials, and all before/after source invariants.
- [ ] Shared Tenant table proof, full CI, CodeQL and security HTTP smoke review any failures.
- [ ] Independent security review confirms no leaked dependent data, false 201, unexpected audit/financial side effects, fixture/workflow boundaries or unauthorized external calls.
- [ ] Remaining HMO approval, coverage transition, non-owner authorization, provider evidence, and concurrency cases needed for a whole-method credit are independently reviewed before separate manifest reconciliation.

**DRAFT / NOT ACCEPTED / DO NOT MERGE / ZERO COVERAGE CREDITS.** Tenant isolation globally is still NO-GO pending independent acceptance; no production feature flags or real-money workflows change.

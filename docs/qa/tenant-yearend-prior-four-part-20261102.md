# Year-end and prior-employer evidence four-method tenant isolation proof review

**DRAFT / NOT ACCEPTED / ZERO METHOD CREDITS.** The inventory retains `GAP`
for all four exact methods until source-pinned four-part proof has passed on
the final PR head and has been independently reviewed. `main` inspected at
`11b6d544cf6bd30c84fc524a088f90627dec09e6`.

| Method | Genuine owned positive | Real victim denied | Victim DB unchanged | Forged selector rejected | Status |
| --- | --- | --- | --- | --- | --- |
| `GET year-end` | JSON + annual preflight and new **provisional real-HTTP success candidates** for nonempty Form 2316 draft text, printable internal worksheet HTML and Alphalist draft source CSV. Actual final-head CI pending; no official BIR acceptance claimed | Real higher-ID employer 403 for JSON, preflight and all three export formats | Synthetic victim tax, payroll, history and audit byte-identical; legitimate exports append only own audit | Real victim employeeId under owned org returns 404 for both 2316 and printable worksheet | GAP (0), new artifact-mode exact-head PG16 pending |
| `POST year-end` | New shared PG16 table candidate: source-bound released fictional payroll -> real nonempty computed adjustment and new Dec31 run binding | Two authenticated attackers use genuine higher-ID victim employer, must return 403 on unbound and bound writes | Whole victim year-end adjustments, payroll/entries, prior evidence, historical and business audits; plus existing shared victim snapshots | Actual higher-ID victim Dec31 payrollRunId under own org must return 404 | GAP (0), pending exact-head run |
| `GET year-end/prior-evidence` | Existing dedicated STA-01 harness: decrypt verified own prior evidence with valid digest from own POST save, two attackers | Real higher-ID victim org 403 | Employees, encrypted evidence, tax adjustments, payroll, audits before/after denials | Victim employeeId under owned org refused 409 | GAP (0), pending exact-head rerun/review |
| `POST year-end/prior-evidence` | Existing dedicated STA-01 harness: persisted own save and independent checker approval with encrypted evidence/digest/audit | Victim employer save/approve 403 | Every denied request preserves underlying victim SQL and audits | Victim employeeId under owned org POST save 409, stale digest and self-approve denied | GAP (0), pending exact-head rerun/review |

## Exact-head workflows

- [Year-end annualization candidate](../../.github/workflows/tenant-year-end-post-candidate.yml) uses the canonical table-driven write harness with two signed-in independent attacker employers and a real higher-ID victim. The new family exercises both `POST` entry modes: unbound annualization with stored own adjustments and the December 31 final-cutoff binding with a real own payroll-run ID. After write, existing `GET` JSON and annual preflight must show nonempty own records. Every victim/forged refusal must be checked against DB state; fake empty successes or 409-only writes cannot pass.
- [Existing prior-evidence proof](../../.github/workflows/tenant-sta01-prior-evidence-http.yml) independently runs a new empty PG16 and the full save/get/approve scenario. [Source](../../scripts/qa/tenant-sta01-prior-evidence-http.mjs) and [contract](../../scripts/qa/tenant-sta01-prior-evidence-contract.mjs) are unchanged; their previous-head passing evidence is NOT borrowed for this head.
- [Existing JSON read proof](../../.github/workflows/tenant-year-end-json.yml) independently repeats nonempty JSON read and denied victim in its own disposable PG16. This is a **bounded JSON mode**, not entire GET certification.
- The existing shared [table-driven proof workflow](../../.github/workflows/tenant-table-proof.yml) can also see the new write family when it runs its allowlisted profile, including the source-level cross-employer response-swap negative control.

The previous default-profile environment enabled `XENDIT_BILLING_ENABLED` even
in otherwise synthetic workflows. Both year-end JSON and prior-evidence CI
workflows now explicitly override that and all payment/payout/provider/CSP
flags to **OFF** before any DB/app import. The new POST workflow uses the
non-money allowlisted-read profile, pins all provider and CSP gates OFF, and
generates only one-time synthetic encryption material.

## Explicit holds

**Whole-method GET remains unaccepted until exact-head CI succeeds and an
independent reviewer accepts the complete proof.** The new table-driven
source-only candidate now seeds valid **fictional** encrypted employee BIR
TIN/branch values and one matching fictional employer BIR identity. It
computes a zero-adjustment, balanced tax-year result from actual released
payroll instead of pretending a refund was paid. A genuine bound December
adjustment must be **settled** before artifact testing. The source preflight
must report `canExportSource=true` and no blocker, otherwise the proof fails.

For **each** of two independent signed-in attackers, the test must retrieve
nonempty real 200 responses from `format=2316` (draft text),
`format=2316-print` (internal HTML review worksheet) and `format=alphalist`
(draft CSV, **not** a prescribed .DAT). It verifies the attacker's seeded
employee marker is in each artifact, that the victim marker is not, the
correct content type, content disposition, no-store and nosniff headers,
plus the Alphalist draft-status header. Each legitimate export appends a
**same-employer** audit row; no fiscal source rows change. Each format's
real higher-ID victim-employer read must return 403 without touching victim
or attacker SQL. The real victim employeeId, under the attacker's employer,
must return 404 for both 2316 modes without victim disclosure. The shared
harness also verifies two independently seeded attackers, genuine written
annualization/binding, response discrimination and untouched victim SQL.

**These are provisional CI tests, not evidence of a real BIR submission,
government validation or payout.** They use only synthetic identity and tax
records inside disposable localhost PostgreSQL 16. All money, POS, provider,
billing, payroll-loan and CSP release gates remain OFF. The author cannot
independently sign off their own method coverage.

The new annualization/binding candidate is not passing evidence until the
dedicated PG16/real-HTTP job verifies the exact final code head. Any discovered
authorization defect must be corrected in a separately labelled source commit,
not by changing test expectations.

No statutory filing, generated official DAT, production database, Neon, real
payroll, external provider, payout, payment, production release flag, real
government identity or live data. No manifest change, no method credit and no
claim of tenant-wide security acceptance.

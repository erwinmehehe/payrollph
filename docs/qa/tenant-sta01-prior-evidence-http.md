# STA-01: prior-employer tax evidence, isolated tenant family

**Draft. Zero new coverage credits. Tenant isolation NOT ACCEPTED. No production, filing, provider, payroll, or real-money authorization.**

## Why this family

- Separate from all currently open PRs #1593 (DL-02 demand import/self-photo/web-bundy evidence), #1602 (Performance), #1605 (PG18 schema ratchet), and #1607 (employee identifier approval).
- Targets two uncredited methods on one route: `GET /api/year-end/prior-evidence` and `POST /api/year-end/prior-evidence`. POST has two valid positive actions, `save` and `approve`, so a one-action response is **not** accepted as full POST proof.
- Makes no modifications to application routes, shared tenant-isolation manifest or common coverage tests. Both methods **remain GAP** until evidence passes the exact PR head, a separate owner reviews it, and the ledger is reconciled in a non-conflicting follow-up.

## What runs

The dedicated [STA-01 PG16 workflow](../../.github/workflows/tenant-sta01-prior-evidence-http.yml) starts an empty, disposable `postgres:16` and a production-mode Next server bound only to `127.0.0.1:3000`. The runner refuses non-CI invocation, remote DB/server addresses, external provider keys, payment activity, disabled MFA, production flags or multi-entity activation **before importing any DB/app code**. A different, one-time random 256-bit synthetic encryption key is exported and masked by GitHub Actions. The server and fixtures use the same reviewed flags.

Three distinct fictional employers are seeded attacker A, attacker B, and then victim C. Each has its own authenticated owner, different independently authenticated MFA-verified checker, actual persisted employee, tax adjustment and encrypted prior-year employer evidence. Victim C has *real higher* employer, employee, adjustment and prior-evidence IDs. The paid provider and background worker are disabled. No actual personal, financial, or payroll data is used.

The source-pinned [HTTP test](../../scripts/qa/tenant-sta01-prior-evidence-http.mjs) requires, for **each** attacker:

- Own `POST save`: HTTP 200 and actual tenant-bound encrypted prior evidence persisted with matching digest, maker, year, employer and a single audit event. No payroll run or adjustment changes.
- Own `GET`: HTTP 200 with a **nonempty, correct** decrypted and verified prior-employer record unique to the signed-in tenant. The real A response must fail C's own-data assertion.
- Foreign victim employer `GET`, `POST save`, and `POST approve`: explicit HTTP 403; no victim marker, prior tax reference, or SHA in the response.
- Forged *higher-ID victim employee* under own employer `GET` and `POST save`: HTTP 409, no victim evidence disclosed or changed.
- Stale digest `POST approve` and maker self-approval: HTTP 409 with no mutation or audit side effect.
- Independent checker `POST approve`: HTTP 200 and actual maker/checker distinct persisted approval, immutable ciphertext/digest, one new audit receipt, unchanged payroll/tax adjustments and unchanged **other employers'** protected records.

The runner snapshots fictional organizations, legal entities, org units, employees, encrypted evidence, tax adjustments, payroll runs, and business audit events before and after **each** denied access. It fails closed on empty own positives, any victim state change, missing or malformed ciphertext, altered previously approved evidence, or unexpected responses. Adversarial source/test contracts run before the app is built.

## Limits and required gates

This is **STA-01 prior-employer evidence only**, with multi-entity disabled. It does not test all statutory filing, payroll release, prior-employer transfers, historical payroll, or other tenant families. The proof uses fictional PG16 and localhost HTTP, not Neon, staging or production. It does not generate statutory forms, contact external systems or process funds.

The job is proof evidence **only if the exact new PR head passes**. The runner emits `coverageCredits: 0`, `productionCertified: false`, `globalTenantIsolationAccepted: false` and `moneyMoved: false`. Any promotion of the two methods from GAP to COVERED requires completed real-HTTP CI and independent security/coverage-owner review plus a separate careful ledger reconciliation that does not conflict with open PRs.

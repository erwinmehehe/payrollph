# MNY-02 partial tenant isolation: contractor records and withholding

**Status: DRAFT — NOT MERGE APPROVED.** Canonical parent: `main@c3beb21c1ed8de7bc066acaeb954368f1d4fcdd2` (includes #1339). No production approval, deployment or regulator/provider submission.

## Six independently exercised API methods (of 33 in frozen MNY-02 queue)

- `GET /api/contractors`: populated owned list vs real foreign employer 403; forged extra contractor selector cannot reveal the real victim object
- `POST /api/contractors`: actual owned creation (201) with encrypted fictional TIN; foreign employer 403 and unchanged victim state
- `PATCH /api/contractors`: actual owned update (200) with forged employer field ignored; real victim-owned contractor ID returns 403
- `DELETE /api/contractors`: actual owned unused row removed (200), forged employer query ignored; victim-owned ID returns 403
- `GET /api/contractors/payments`: real owned EWT rows (200) and CSV bytes, real victim employer 403, forged contractor query confined to actual authorized employer
- `POST /api/contractors/payments`: actual fictional EWT accounting record (201) and persisted owner/audit; foreign employer 403, victim-only contractor ID supplied under own employer 404

The fixture creates both independently authenticated owner employers' real contractor and payment rows first. Victim contractor/payment objects are read back from disposable PostgreSQL and must have IDs greater than six and greater than every corresponding attacker-owned ID. The post-denial SQL snapshot checks victim contractors, EWT payment rows, audit chain records and payroll runs exactly. **No actual contractor payout or payroll transfer is made.**

## Source-identified cross-employer FK integrity gap

A pre-existing EWT report query filtered `contractor_payments.organization_id` but joined `contractors` solely on `contractor_id`. The current schema's FK guarantees a contractor ID exists but does not enforce that both organization IDs match. An abnormal legacy/imported payment row can therefore associate an owned EWT liability with another employer's contractor identity. This is a **source-identified integrity/possible disclosure gap**, not evidence of an actual historical breach.

This PR uses a left join so orphaned rows are not silently dropped and fails the **entire authorized report** with generic **409**, both JSON and CSV, when contractor attribution is missing or foreign. The regression uses a temporary, explicitly fictional mismatched FK in the guarded `127.0.0.1:5432/app_db`, checks no victim identity or TIN is returned, restores the test row, and verifies ordinary own totals recover.

## Evidence and pending gates

- HTTP/DB execution: `scripts/qa/tenant-mny02-contractors-http.mjs`, invoked from `scripts/qa/tenant-second-pass-http.mjs` only after `requireDisposable()`.
- Static link guard: `tests/tenant-mny02-contractors-source.test.mjs`.
- Existing whole-route guard: `tests/tenant-isolation-coverage-inventory.test.mjs` uses an explicit six-method source allow-list and exact positive, denial, forged and unchanged SQL line references.
- Required CI: `npm test` (including four regression shards), security HTTP smoke on **exact PR head**, lint/typecheck, Next production build, CodeQL where applicable.
- **No green claim yet.** The six `COVERED` labels are provisional, subject to exact-head executable checks and independent security/code-owner review.
- Prior baseline: **139 COVERED / 10 PUBLIC-BY-DESIGN / 344 GAP** (493 API methods). This draft provisional state: **145 COVERED / 10 PUBLIC-BY-DESIGN / 338 GAP**. **Nineteen page/action gaps** remain. No new public methods, migration, provider or release flags.
- Confirmed real-world leaks found: **none demonstrated**. Source-identified integrity guard added: **one**.
- Non-scope: all other 27 MNY-02 methods, complete tenant-isolation certification, production data repair, real BIR submission, payment provider acceptance, financial release, staging or deployment.

## Reviewer checks before a source merge

1. Validate the direct real-HTTP 201/200 positives for **each** of the two independent attacker employers and persisted real victim ID order (>6).
2. Validate expected foreign 403/404, forged selectors and unchanged victim PostgreSQL evidence for **all six** methods.
3. Review generic 409 for a mismatched/orphaned FK against legitimate historical contractor data and any downstream EWT reporting workflows.
4. Verify exact-head CI/security checks, cross-PR base drift and independent human approval; do not enable real payment providers or infer launch readiness.
5. After merge approval, monitor the reporting error contract and document any affected **real** customer data through normal incident and remediation channels; do not auto-fix attribution.

**Safe rollback:** revert the source/QA change. There is no migration, production SQL, remittance, transfer or release-flag change in this PR.

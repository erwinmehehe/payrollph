# #601 People Intelligence amount-evidence correction

Base: `main@de6d0fb597d25e1af3db68dfe1f4884353c1916c`. This is a bounded source correction, not closure of the Enterprise HCM epic.

## Status reconciliation

PR #67 (interactive browser-local People demo) was merged on 2026-09-30. That historical demo delivery is separate from enterprise HCM acceptance.

Issue #601 is open. Its comments record merged planning/recruitment lineage (#613), enterprise identity hardening (#616), People Intelligence (#618), and talent continuity (#624). Current source still explicitly defers true send-back, correction, resubmission and rescind in `docs/hcm-business-process-v2-action-center.md`. The issue's remaining source, concurrency, customer identity, privacy and operational acceptance criteria must not be checked off just because earlier slices merged. No issue status or checklist is changed here.

## Reproduced defect and correction

The pure report reducer used JavaScript number coercion for recorded financial evidence. Empty strings, whitespace and runtime null could pass as zero; numeric syntax that is not a database decimal could also be accepted. Vacancy/cycle budgets and compensation deltas had no safe aggregate bound. Released-payroll aggregates checked finiteness, but still accepted finite values above safe integer-centavo reporting magnitude.

Require present, nonnegative decimal-string evidence with a finite amount no greater than `Number.MAX_SAFE_INTEGER / 100`. Bound each nonnegative aggregate as it is accumulated. For approved salary movement, validate and bound both prior and proposed annual totals before subtraction so equal oversized salaries cannot cancel into a seemingly trustworthy zero. This remains aggregate reporting; it does not change the payroll arithmetic or stored financial ledger.

Affected metrics become `null` with source-specific data-quality warnings. Existing UI/CSV projection displays unavailable values as “Not verifiable.” One malformed gross amount does not hide an independently valid net amount. Verified empty sets and explicit decimal zero remain zero. Legitimate annual salary decreases remain signed. Draft/out-of-window payroll, closed cycles, unaccepted proposals and unapproved positions remain outside the existing metric scopes. Historical current-state metrics remain withheld.

## Verification and limits

`tests/hcm-people-intelligence-money-evidence.test.ts` exercises missing/coercible values on all five financial metrics, oversized individual and accumulated evidence, cancellation, verified empty/zero, ordinary decimal totals, valid decreases, scope exclusion and historical withholding. Existing analytics tests retain date reconstruction, historical uncertainty, privacy suppression, company-wide permission/source wiring and released-only payroll checks.

No API handler, tenant predicate, role gate, salary proposal/approval, schema, migration, provider, feature flag, payroll calculation/release or money movement changes. No API coverage credits. Local tests use fictional in-memory data only. Exact-head CI and real-employer financial/HR reconciliation remain separate and are not claimed by this patch. Rollback is a source revert.

# HCM recruitment-to-goals: Frappe HR code-reference gap review

## Sources inspected, reference-only
- Frappe HR [Job Offer](https://github.com/frappe/hrms/blob/develop/hrms/hr/doctype/job_offer/job_offer.py): offer uniqueness, vacancy checks and applicant state transitions.
- Frappe HR [Employee Onboarding](https://github.com/frappe/hrms/blob/develop/hrms/hr/doctype/employee_onboarding/employee_onboarding.py): one onboarding per non-cancelled job offer, task completion and employee conversion.
- Frappe HR [Goal](https://github.com/frappe/hrms/blob/develop/hrms/hr/doctype/goal/goal.py): parent/child identity and appraisal-cycle matching, and goal updates.
- Frappe HR [Appraisal](https://github.com/frappe/hrms/blob/develop/hrms/hr/doctype/appraisal/appraisal.py): cycle-linked reviews, KRA scoring and separate approval evidence.

Frappe HR is GPL-3.0. This is an original PayrollPH implementation and architecture comparison; no Frappe source, UI, CSS, JSON schemas or scoring formulas were copied. PayrollPH remains Next.js/TypeScript/PostgreSQL with Philippine payroll as its own authoritative financial subsystem.

## Already connected in PayrollPH
1. Requisition -> applicant -> reviewed job offer -> independent HCM hire approval -> atomic employee/pay profile/position assignment/onboarding tasks. Sources: `src/app/api/recruitment/route.ts`, `src/app/api/recruitment/hire/route.ts`.
2. Employment terms, positions, effective-dated changes, probation and separation are maintained in their existing authoritative HCM and payroll records.
3. Performance holds company/team/employee goal hierarchy, review cycles, competencies/KRAs and structured reviews. Source: `src/app/api/performance/route.ts`.
4. Connected worker journey uses tenant-scoped source evidence rather than reconstructing another employee master.

## This PR: bounded, read-only connection and stronger goal invariants
- Parent goals must follow company -> team -> employee tiers when a parent is selected; employee parents belong to the exact recorded org unit.
- Parent and child have exactly the same appraisal-cycle ID, **including the difference between null and a concrete cycle**.
- Parent goal picker filters options by current cycle and matching organizational tier; changing employee or cycle clears a previously selected parent.
- Worker Journey shows up to 20 most-recent employee goal status records, with an explicit more-records warning when appropriate. It never sends descriptions, free-text evidence, pay or performance ratings in this preview.
- A goal without a review is **not** a completed appraisal; a completed review does not imply a pay approval. The existing review remains the primary source reference when present.
- No schema, payroll math, approval authority, bank, feature flag, production config, or employee mutation changes.

## Future implementation areas, not included in this PR
- Appraisal-cycle and KRA-linked goal-score aggregation under documented weights, stale-source detection and explicit human review. Do **not** infer a final appraisal from child completion percentages.
- Governed onboarding activity templates/owners, escalation, holiday-aware task deadlines and evidence of completion, preserving existing provisioning tasks and maker-checker hire gates.
- Full applicant/offer/onboarding/worker lifecycle audit with applicant PII minimization, bounded APIs, two-tenant tests and role-specific evidence.
- Enterprise BP v2 send-back/correction/rescind with append-only revisions, not an alias for decline.

## Acceptance before integration
- Current-head TypeScript, lint, full test suite, payroll golden suites and production build.
- Goal hierarchy/cycle regression, Worker Journey privacy/tenant source checks and relevant HCM synthetic browser/security checks.
- Product/HR review of goal hierarchy UX; real-employer UAT remains separate from synthetic-source merge.

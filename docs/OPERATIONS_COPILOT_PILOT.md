# Linaw Operations Copilot — read-only pilot

Status: **DRAFT / NOT ACTIVATED / NOT PRODUCTION ACCEPTED**.

This adds a standalone, source-linked Payroll Exception Copilot and HR Operations Agent.
It does **not** modify payroll calculations, bank transfers, approvals, wage orders,
journal posting, government filings, employee lifecycle, or Automation Studio actions.
No SQL migrations, environment defaults, third-party provider credentials or hosted
deployments are included.

## Routes (enabled only for an authorized sandbox or staging pilot)

- HR: /hcm/operations-copilot?area=hr&organizationId=<employer_id>
- Payroll: /hcm/operations-copilot?area=payroll&organizationId=<employer_id>&runId=<run_id>
- Multi-entity payroll: include the selected authorized &legalEntityId=<legal_entity_id>
  when the active multi-entity policy requires an explicit employer selector.
- GET /api/operations-copilot with the same query selectors for the read-only brief.
- POST /api/operations-copilot with the same selectors for an **optional model narration only**.
  POST cannot create HR cases, payroll runs, approvals or any payment instruction.

The page requires server-side authentication and role checks. Both API operations
repeat these checks. The HR view is limited to company-wide, people-admin authorized
members with the established deny-only permission overlay. Payroll uses the existing
run-to-member resolution, payroll-operator role gate, org-unit scope and legal-employer
guard. Foreign or mismatched runs fail without disclosing payroll findings.

## Read-only data sources

- Payroll: the existing buildPayrollAssurance function on a known, authorized
  run. The copilot uses ONLY existing finding codes, severity and blocking;
  it groups codes, counts source findings and maps to preexisting deterministic
  explanations. Employee IDs, bank details, gross/net amounts, private titles
  and notes are discarded before assembling the browser brief.
- HR: the existing automation_operational_cases table scoped to one organization
  with statuses open or acknowledged. Window totals count all matched cases,
  while 31 candidates are fetched to render a 30-item preview. No case title,
  case notes, employee context or private source payload is selected.
- Case summaries are not new records, escalations or ownership decisions.
  Items link to the existing source workflow.

An empty source is **not** a certification that payroll is ready or HR work is
complete. A failed query is an unavailable state, never a verified zero. A bounded
HR preview is not a complete HR work census.

## Default-off switches

Read-only UI/API, separately:

    OPERATIONS_COPILOT_READONLY_ENABLED=true

This switch is OFF by default. Enable it **only** for approved synthetic staging
or isolated pilot tenants after access/security reviews. A switch does not
represent approval, acceptance or completed testing.

Optional third-party AI narration has an additional independent switch:

    OPERATIONS_COPILOT_MODEL_ENABLED=true

It also requires the **existing** per-tenant model consent gate, including:
OPENAI_AUTOMATION_DRAFT_ENABLED=true, OPENAI_API_KEY, confirmed privacy
processor/DPA, retention, notice and OPENAI_AUTOMATION_APPROVED_ORG_IDS.
Do **not** set any of these flags merely to pass a test. Confirm real organizational
approvals, local privacy and security requirements, and contract terms first.

The model sees ONLY an aggregate snapshot:
- payroll: source finding codes, counts, severity and template next steps
- HR: open, overdue and unassigned aggregate counts

No employee-specific records, case IDs, tenant IDs, amounts or private text are
passed to the model. Model output is display-only, typed JSON with source-key
validation and no approval/automation authority. Narration is explicitly labelled
a draft. Failed or disabled narration leaves the deterministic triage view intact.

Model POST requires same-origin browser security, current privileged MFA when
required in production, and per-user/resource rate limiting. No prompt log,
provider body or token is printed.

## Pilot acceptance checklist (not yet completed)

1. Exact-head npm ci, npm run typecheck, npm run lint, and
   npx tsx --test tests/operations-copilot.test.ts.
2. Confirm CI and security checks at the actual pull-request head, including
   source-ledger and privacy/tenant coverage. Do not repin or lower historical
   proof thresholds to pass checks.
3. Disposable PostgreSQL 16 and 18: test two different tenants, unit-scoped
   payroll operator, company-wide HR and restricted HR, cross-employer run IDs,
   unavailable database, malformed selectors, and 31+ open cases.
4. Confirm no employee identifiers or sensitive details in browser responses,
   optional external request bodies, telemetry or error logs.
5. Check desktop, 390px/mobile, keyboard navigation and empty/error/loading
   states with fictional data.
6. Run real signed-off Privacy / Payroll / HR reviewer acceptance before any
   feature flag or model allowlist is enabled in production.

This is a **first read-only pilot**, not an autonomous agent permitted to take
real actions. Later phases may propose draft tasks and follow-ups only after
separate approval and source-governance design; no such write capability is
included in this patch.

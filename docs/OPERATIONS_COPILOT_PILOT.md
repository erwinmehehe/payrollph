# Linaw Operations Copilot — read-only pilot

Status: **DRAFT / LOCAL-ONLY / NOT PRODUCTION ACCEPTED**.

The new Next.js API and HCM page are deliberately hard-disabled when
NODE_ENV=production, even if pilot tenant environment variables have been set.
This is a deliberate fail-closed restriction until method-specific and SSR
tenant-isolation acceptance are independently verified.

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

## Default-off, tenant-scoped pilot activation

The pilot deliberately does **not** edit the shared critical release-flag
registry. That file is source-sealed by existing tenant, security and
financial acceptance proofs; editing it would invalidate unrelated coverage
and require independent re-execution and review. This feature instead uses
a dedicated strict allowlist of authorized tenant IDs. No global boolean
switch can accidentally activate the pilot for other tenants.

Read-only pilot (entirely OFF when omitted):

    OPERATIONS_COPILOT_PILOT_ORG_IDS=17

Multiple explicitly approved tenants can be comma separated. Empty,
duplicate, malformed or unsafe-number entries fail closed for the entire
list. The tenant selection is never treated as sufficient authorization:
each read additionally enforces session, role, permission overlay, org-unit
and payroll legal-employer rules.

Optional third-party AI narration has a separate, equally restrictive
tenant allowlist (OFF when omitted):

    OPERATIONS_COPILOT_AI_PILOT_ORG_IDS=17

It also requires the **existing** per-tenant external-model consent gate:
OPENAI_AUTOMATION_DRAFT_ENABLED=true, OPENAI_API_KEY, verified processor/DPA,
zero-retention, notice and OPENAI_AUTOMATION_APPROVED_ORG_IDS. To enable
narration, a tenant must be on all three allowlists, with the other
existing protections satisfied. The numeric tenant values above are
fictional examples, not production activation instructions.

These environment values do not constitute Privacy, Payroll or HR approval.
The release owner must maintain external approvals and deployment records.
Do **not** set any of these values merely to make a test pass. Keep all
production allowlists unset until genuine sign-offs and staging acceptance.

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

## Tenant-isolation inventory review (zero credits)

The original scripts/qa/tenant-isolation-coverage-manifest.json remains
byte-for-byte unchanged because existing third-party and financial isolation
proofs are cryptographically sealed to it. The two new copilot API methods
(GET and POST) and one new HCM SSR page instead appear in the separate
scripts/qa/operations-copilot-isolation-supplement.json.

Two separately source-sealed versions of the preexisting manifest are
accepted: the exact PR-base blob `df3e1301b67ec1b2c271f4393f91511b7e8035c5`
and the preexisting newer `main` blob
`c8722f5420ec6584b3c1ebdff76fc5d508a762a5` used by GitHub's
synthetic PR merge jobs. The intermediate upstream blob `c024f9699f3770693625fcaf9982e7ed39eed57f` is no longer an accepted current-main version. An arbitrary repin or changed manifest is refused.
Neither version adds a Copilot credit, and the PR does not alter the
historical ledger itself.

The supplement is source-pinned and verified by
scripts/qa/operations-copilot-isolation-supplement-verify.mjs and the shared
inventory test. Each new entry has status GAP, zero credits, no asserted
own/victim HTTP evidence, no production acceptance and no implicit
permission to publish. The full inventory is the union of historic sealed
entries plus this exact review-only supplement; it must not silently exclude
other new routes.

Later promotion requires a new independent two-employer real-HTTP proof,
actual own-data responses, genuine cross-tenant and revoked-session denial,
unchanged victim database snapshots, and authorized privacy/security/payroll
review. Re-running only unit tests or changing manifest counts is not proof.

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

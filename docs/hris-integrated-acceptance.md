# Linaw HRIS integrated acceptance — synthetic engineering evidence

**Scope:** HR Home → Employee 360 → My Team → onboarding → approvals.

## Evidence rule

The only automatable PASS is the GitHub Actions job **HRIS Integrated Journey Browser QA (Synthetic Only)** on an exact commit SHA. A source file, draft PR, green unrelated workflow, or this checklist is not acceptance evidence. Attach the completed run URL and head SHA after it passes. Never interpret synthetic test identities as consent or payroll validation.

## Isolated test environment

- Disposable PostgreSQL 16 database at local `127.0.0.1`, with two fictional legal employers and deliberately overlapping employee numbers
- Local Next.js process at `http://127.0.0.1:3000`, synthetic flags only, headless Chromium and test-only credentials
- HR user authorized in both employers, manager authorized only in one current unit, and a unitless manager expected to be denied
- No production database, email provider, bank connection, model API, government filing, statutory certification or payment

## Automated browser and API checkpoints

| Check | Pass condition |
| --- | --- |
| HR Home | HR role can open Employee directory from authorized role-filtered People Operations shortcuts |
| Employee 360 | Selected employee's modal shows sourced employment, onboarding, documents, leave, performance and history sections, without other-employer data |
| Onboarding | HR can open existing Recruitment checklist and record a named task for the selected employer/employee |
| Employer/worker binding | Wrong employer and malformed `done` cannot write an onboarding item |
| Refresh and source truth | Successful checklist write reappears as `done=true` on the authoritative provisioning endpoint |
| Employer switch | First employer's onboarding item disappears when HR navigates to the other employer |
| Manager My Team | Manager with active same-employer unit sees only scoped staff; source counts remain page-limited |
| Approvals handoff | Team action link opens governed Approvals workspace; a nonfinancial synthetic role-assigned task can be independently confirmed |
| Tenant isolation | Manager cannot view another employer's My Team API |
| Unassigned manager | Manager without an active assigned unit receives a denial |
| Browser integrity | No uncaught client JavaScript exceptions during flow |

## Manual review required before employer pilot

- HR operator and unit manager walk through the same sequence at desktop and 375px width, using an isolated staging employer
- Confirm keyboard focus, loading/empty/retry states, selected employer persistence and visible pending/assigned labels
- Review on/off pilot navigation for the selected tenant, role, permission-set and feature flags
- Verify real policy owner approval of onboarding checklist definitions and manager approval assignments
- Apply production migrations only after separate DBA review; confirm encryption and transactional email gates
- Perform independent real-pay-month parallel reconciliation before allowing any live payroll release or bank transfer

## Release decisions

Passing this synthetic workflow is **code-level cross-surface acceptance only**. It does not close operational security, statutory, payment, privacy, backup/restore, external-provider or real-employer parallel-run blockers in repository issues #744 and #112. Keep financial/payout/provider rollout flags OFF until separate documented approval.

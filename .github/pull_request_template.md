## Release lane and dependencies
- Lane: `WFM | HRIS/HCM | Payroll/Financial | Database/ESS | Automation | Billing | Platform`
- Canonical PR for this feature (or **this PR**):
- Parent/base PR (or `main`):
- Blocked by:
- Supersedes (with exact source/diff evidence; do not assume overlaps are duplicates):
- Is this one of the **maximum three actively review-ready PRs**? `yes | no (draft)`
- If SQL is added: reserved migration prefix(es), predecessor PR, DBA applied-journal status:

## Scope and behavior
Describe the problem, fix, affected tenants/modules, risk of incorrect pay/data changes, and feature-flag state.

## Change risk (also see the advisory PR Change Risk job)
- [ ] T0 — docs/content/non-executable
- [ ] T1 — ordinary application code
- [ ] T2 — payroll/WFM/identity/AI automation
- [ ] T3 — compensation/bank/ledger/schema/recovery

Why this tier? If several apply, select the highest. See [change-risk policy](../docs/engineering/change-risk-policy.md).

## Merge evidence
- [ ] Exact-head applicable CI/security checks passed (links below)
- [ ] Target branch checked for drift / conflicts
- [ ] Focused reviewer findings resolved (independent review for T2/T3 when required)
- [ ] No real payroll data, credentials or protected evidence added to GitHub
- [ ] Safe rollback / rollout plan documented where applicable

Tests and reviewed commit:

## Separate staging / activation / production gates
- Staging scenarios and witness (or **not yet run**):
- Feature flag / disabled-by-default behavior:
- Migration / bank / statutory / privacy reviewer (where applicable):
- Deployment and real-money payroll authorization: **NOT granted by this PR**

Do not check boxes for tests or independent approvals that have not happened.

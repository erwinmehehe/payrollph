## Release lane and dependencies
- Lane: `WFM | HRIS/HCM | Payroll/Financial | Database/ESS | Automation | Billing | Platform`
- Canonical PR for this feature (or **this PR**):
- Parent/base PR (or `main`):
- Blocked by:
- Supersedes (with exact source/diff evidence; do not assume overlaps are duplicates):
- Is this one of the **maximum three actively review-ready PRs**? `yes | no (draft)`
- If SQL is added: reserved migration prefix(es), predecessor PR and actual applied-journal status:

## Scope and behavior
Describe the problem, fix, affected tenants/modules, risk of incorrect pay/data changes, and feature-flag state.

## Change risk (see advisory PR Change Risk job)
- [ ] T0 — docs/content/non-executable
- [ ] T1 — ordinary application code
- [ ] T2 — payroll/WFM/identity/AI automation
- [ ] T3 — compensation/bank/ledger/schema/recovery

Why this tier? If multiple apply, select the highest. See [change-risk policy](../docs/engineering/change-risk-policy.md).

## Source merge evidence (no blanket independent-review requirement)
- [ ] Exact-head applicable CI/security/domain checks passed (links below)
- [ ] Maintainer checked incremental diff, base drift and dependency conflicts
- [ ] Focused test failures and security findings resolved
- [ ] No real payroll data, credentials or protected evidence added to GitHub
- [ ] Safe rollback / activation plan recorded where applicable

Tests and exact reviewed commit:

## Separate staging / activation / production gates
- Staging scenarios and witness (or **not yet run**):
- Feature flags / disabled-by-default behavior:
- Migration / bank / statutory / privacy external approval if genuinely required for **live operations**:
- Deployment and real-money payroll authorization: **NOT granted by this PR**

Do not mark a test, external approval, provider receipt, or production rollout as completed unless the evidence exists.

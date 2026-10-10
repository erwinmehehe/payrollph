# Integrated HCM legacy-write safeguards — review candidate

Combines draft PRs #633, #636, and #638 into one **draft** branch so the controls can be regression-tested together. The separate source PRs must not be independently merged if this integration is chosen.

**Enforced policies**: Employer-configured Hire business processes prevent new employee creation through legacy POST and CSV imports, ordinary CSV is create-only, pre-live employee-master migrations are limited to evidenced owner/admin actions with encryption/transaction audit, and legacy direct salary edits cannot bypass employer compensation approval policy. Non-governed legacy workspaces retain scoped correction paths with authenticated MFA and a reason.

**Still missing**: Goverened backward-dated salary correction/retro processing and some manual position/separation routes need independently reviewed business workflows. The CSV importer and initial employee-master migration now share a per-employer transaction advisory lock. It does not serialize standalone employee creation or other HR writes; real production cutovers still require coordinated maintenance and uniqueness controls. See #610.

**Release requirements**: Exact-head CI/CodeQL + Postgres integration; independent staging HR/payroll review of conflict races, maker/checker source snapshots, compensation blocked/correction paths, duplicate CSV and rollback injection; DPO/privacy and tenant data migration approvals; proven production deployment gating. Do not execute on real employees, change bank data, or enable automatic wages based on synthetic CI.

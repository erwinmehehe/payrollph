# Maker-checker escalation candidate

Status: **default-OFF staging engineering candidate**, not certified release.

Existing approval-chain policies, per-tenant ordered amount-step routing, role/named approvers and expiring delegation remain authoritative. Additional optional field `escalationAfterDays` (1–30) on each step is captured in the frozen policy snapshot. The central scheduler can mark overdue pending tasks High with an audit event; it never auto-decides, releases payroll, changes money, or treats delegation as identity.

Enable `APPROVAL_CHAIN_ESCALATIONS_ENABLED=true` only after independent HR/payroll/scheduler acceptance. While enabled, a payroll checker must have explicit valid maker user ID in its original submission audit metadata, and the checker must be a distinct authenticated human. No delegated chain can bypass this rule. Legacy behavior remains otherwise unchanged when gate OFF, including existing mandatory maker-checker rejection.

Test `TZ=Asia/Manila npx tsx --test tests/approval-chain-escalation.test.ts`. Then exact-SHA `tsc --noEmit`, lint, golden payroll suites, full suite, delegate expiry and multi-tenant UAT. This does not demonstrate every requested business-process chain (leave/OT/expenses/final pay) has been independently accepted. No production flag or migration action.

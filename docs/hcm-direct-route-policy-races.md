# HCM direct lifecycle route race controls

Status: Draft engineering hardening; no production HR, payroll, or security acceptance.
Tracks #610. Backdated salary corrections are independent under #641.

Policy writes and direct legacy source routes share the tenant-wide transaction
advisory lock namespace 4195, key organizationId. Configured Hire BP definitions
(even inactive/expired) block direct employee creation and import. Both routes
recheck governance under the lock after preflight and before inserting employees.
Intake routes hold namespace 4212 first, 4195 second. Single employee insert
and initial pay-profile creation commit atomically; concurrent employee number
collisions are rejected after taking the intake lock.

Published-plan execution cannot create/approve positions directly when Create
Position BP governance is configured. Existing approval modules remain the
source of truth; this change adds no approval mutation, DDL, payroll recalculation,
payout, salary changes, government filing, or released ledger edits.

Remaining: all direct DBA/background writes must be audited separately. Stage
concurrent policy-save and single hire, CSV and position execution races with
two tenants, custom permission denies and real HR operator review. Do not close
#610 or authorize production based on only these static guard tests.

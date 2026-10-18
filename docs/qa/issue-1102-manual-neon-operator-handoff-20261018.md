# #1102 final operator handoff — fictional demo run header correction

**Status:** MANUAL REVIEW ONLY / ORIGINAL NEON ROWS NOT YET CORRECTED / NO LIVE NEON WRITE FROM THIS PULL REQUEST.

## Work completed and verified

- The public-demo generator fixes for future seeded records are already merged (#1107/#1217).
- PR #1245 was merged as main commit `d49f2835d5cd2ee20f50763920eeca22cc967299`, with **12/12 green checks**. It added PostgreSQL 16 and 18 disposable-database tests for an original-header mismatch, compare-and-swap correction, rollback, committed reversal, idempotency refusal and preserving non-header fictional employee data.
- Vercel reported the exact #1245 main commit **READY**; merge only ships docs and QA code and does **not** update the historic stored values.
- Last confirmed read-only Neon check after #1245 merge still showed the same three unchanged mismatches on `br-lucky-sound-b79i56jw`. A prior direct guarded update attempt returned a platform safety block, not a successful write receipt. **Do not assume any correction was applied.**

## Sole proposed original-data change

**Database identity:** Neon project `calm-wave-70219564`; default Vercel-connected branch `br-lucky-sound-b79i56jw`; endpoint `ep-cool-hat-b7e7gpoo`; PostgreSQL 18 database `neondb`. One *fictional* Loom & Local organization with ID 1, eight mock employees, three historical payroll runs (IDs 1–3), and 18 employee-detail rows. The application’s actual Production connection mapping should be separately confirmed privately; Neon project metadata alone does not prove the live runtime credential.

| ID | Preserved status | Before gross | Before net | Proposed gross | Proposed net |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1 | Released (fictional status, NOT confirmed bank settlement) | ₱176,300.00 | ₱145,645.00 | ₱181,300.00 | ₱147,400.00 |
| 2 | Pending approval | ₱181,250.00 | ₱149,768.00 | ₱182,800.00 | ₱148,600.00 |
| 3 | Needs review | ₱183,400.00 | ₱151,524.00 | ₱184,300.00 | ₱149,800.00 |

**Change exactly six scalar cells:** `public.payroll_runs.gross_pay` and `public.payroll_runs.net_pay` in IDs 1, 2 and 3. No rows added/deleted; no employee, payroll-entry, status, period, line item, trace, journal, payroll-job, approval, bank, provider, audit-event or filing rows changed.

## Safeguarded operator procedure

This handoff adds a review-only SQL file (`docs/sql/issue-1102-legacy-fictitious-header-REVIEW-ONLY.sql`) and this companion runbook. It is connected **only** to a disposable PostgreSQL 16/18 GitHub Actions rehearsal, which also tests the unchanged original SQL's wrong-target refusal. It is **not** wired to Drizzle migration sources, a scheduled production job, a live Neon database connection, app startup, or production deployment.

1. **Verify identity and quiescence:** Log in through the appropriate authorized database-administration channel using a direct, unpooled PostgreSQL session (transaction-level session settings and temporary tables are required). Confirm the exact project, branch, read/write endpoint, database and role. Check the selected production service database route independently. Confirm this is still **only fictional pre-customer data**, and check that no payment, payout intent, approval, provider webhook, underpayment request, attendance correction, bank upload or agency filing has occurred for these three rows. Coordinate a temporary hold on demo writes while operating: the SQL refuses existing dependencies, but no code-only guard substitutes for controlling simultaneous application writes.
2. **Preserve before-state:** Retain the owner’s original six amounts, row MD5 fingerprints and non-header table fingerprints in [#1102 pre-commit receipt](https://github.com/erwinmehehe/payrollph/issues/1102#issuecomment-6251233021). Because the retained Neon snapshot is from October 12 and a prior snapshot restore unintentionally reassigned the production endpoint (#899), do not assume a snapshot restore is an acceptable undo. Take a suitable owner-controlled extra recovery copy if available. A paid AWS system is **not required for fictional development**.
3. **Review the exact SQL:** The source file begins a `SERIALIZABLE` transaction, requires matching Neon session identity and exact original rows, checks the whole 8/3/18 fictional scope, checks no linked payouts, provider events, underpayment, approvals, adjustments, attendance dependencies or filing evidence, validates 18 employee details, takes locks, changes only six cells and asserts exactly 3 rows updated with reconciled totals. On unexpected data or concurrent changes it raises an exception. Its last command is intentionally **ROLLBACK**.
4. **Dry run first:** As authorized operator, execute the reviewed SQL **unchanged** in a trusted SQL session. Observe `ISSUE1102_DRY_RUN_PASSED_3_FICTIONAL_HEADER_PAIRS` and all three proposed totals. The final `ROLLBACK` must leave original totals untouched. If anything fails, do not override a guard or substitute a different Neon branch.
5. **Explicit live apply:** Only after owner/DBA approval of that same target, a proportionate recovery/undo plan and successful dry run, deliberately change the **final ROLLBACK to COMMIT**, preserving all preceding SQL exactly. Execute once in a single uninterrupted transaction. Record the actual execution time, operator, target identity, three changed IDs and 6 exact centavo pairs. No automatic action in GitHub is allowed to apply it.
6. **Independent verification:** In a new read-only session, require three rows with six entries each, each header equal to its entry sums; eight existing fictional employees; statuses and periods unchanged; no differences in the preserved employee/detail/audit/org fingerprints. Validate all three hosted payroll summary screens. If any check fails, escalate. Do not assume Vercel deployment rollback reverses committed PostgreSQL records.
7. **Close issue only after proof:** Attach the sanitised actual SQL execution receipt and separate read-only postflight to #1102. Close #1102 only when both original Neon header/line reconciliation and UI verification pass. Real-employer payroll acceptance (#579), agency filing validation and money release remain separately **NO-GO**.

### Automated disposable-PostgreSQL validation (not production certification)

- The PostgreSQL 16/18 GitHub Actions rehearsal now checks the **committed review-only SQL file**, not a separately hand-written copy of its guards. The unchanged file must fail closed on the deliberately wrong local database identity and leave all fictional rows untouched.
- To exercise the successful SQL path without accessing the target Neon branch, the CI runner derives **local-only** row/table MD5 witnesses from the seeded throwaway `app_db`, substitutes exactly the three run hashes, four immutable-table hashes and the database name in memory, and emulates the Neon identity session settings **only inside disposable PostgreSQL**. All remaining SQL comes from the committed file and its final `ROLLBACK` remains unchanged.
- CI validates three proposed header pairs inside that rolled-back transaction, verifies the original before-image afterward, and injects representative disposable payout-batch, payout-transfer and provider-event records to prove the new dependency gate refuses them. CI must never convert this file to `COMMIT`, use Neon credentials, or execute against a network database.
- This deliberately **does not** certify byte-for-byte successful execution against the original Neon rows: fixture-generated timestamps/fingerprints are not the original Neon before-state. Human approval, direct Neon identity validation, a separately retained recovery receipt, the default-ROLLBACK human dry run and independent DB/UI postflight remain mandatory.

### Independent read-only postflight SQL

```sql
SELECT r.id, r.status, r.period_label,
       r.gross_pay::numeric(18,2)::text AS header_gross,
       r.net_pay::numeric(18,2)::text AS header_net,
       COUNT(e.id)::int AS details,
       COALESCE(SUM(e.gross_pay),0)::numeric(18,2)::text AS detail_gross,
       COALESCE(SUM(e.net_pay),0)::numeric(18,2)::text AS detail_net
FROM public.payroll_runs r
JOIN public.organizations o ON o.id=r.organization_id
LEFT JOIN public.payroll_entries e ON e.payroll_run_id=r.id
WHERE o.name='Loom & Local' AND r.id IN (1,2,3)
GROUP BY r.id
ORDER BY r.id;
```

Expected: each run has `details=6`, matching header/detail gross and net pairs `181300.00/147400.00`, `182800.00/148600.00`, `184300.00/149800.00`. If returned headers are the **old** values, the real correction is not complete. Do not mark the issue closed.

### Reversal note

Historical before-values are preserved in issue #1102. An operator should only consider a **new**, separately controlled compare-and-swap reverse transaction if the exact just-applied target amounts, statuses, source entries and audit state still match, with zero intervening dependencies. Never blindly replay stale reversal SQL or perform Neon snapshot promotion as routine undo.

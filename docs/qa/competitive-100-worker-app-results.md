# Competitive 100-worker benchmark: PayrollPH connected synthetic execution

**Classification:** Fictional-only engineering acceptance candidate. Not real-employer certification, nor a tested Rippling, UKG, Workday or Sprout comparison.

## Environment
- GitHub Actions workflow: .github/workflows/competitive-100-worker-app-acceptance.yml
- Runner: scripts/qa/competitive-100-worker-app-acceptance.ts
- 100 invented employees: NCR 40, Region VII 35, Region XI 25.
- 2026-06-01 to 2026-06-15 payroll period; 2026-06-20 pay date; June 12 holiday.
- Fresh, empty GitHub-hosted PostgreSQL 16 at **127.0.0.1**. Localhost Next.js app. No production Neon, customers or real staff.
- Disbursement, external AI, government submissions and third-party provider credentials explicitly disabled.
- Application payroll is intentionally NOT released.

## Observable requirements
1. Owner creates all 100 through the real authenticated employee API; 40/35/25 regional split is persisted.
2. All 100 receive assigned work schedules via WFM APIs and appear in the team roster.
3. 105 historical *seeded fictional* punches preserve employee and work-date identity. They are not real-device events.
4. A distinct manager approves actual F008 overtime.
5. Payroll is denied when required timecards are missing or unapproved; manager self-approval is denied.
6. 100 timecards are submitted by a manager and approved by a different HR role; cutoff lock enforced.
7. The real payroll route generates exactly 100 employee entries with source-traced payable-time segments.
8. Three night workers, five June 12 holiday workers and one approved OT worker are source-traced; statutory amounts are not independently certified.
9. Two missing bank profiles trigger high-severity assurance blockers.
10. The existing assurance function flags three injected synthetic prior/current variances in a separate pure-function test, NOT in the calculated payroll run.
11. Tenant-B owner cannot inspect tenant-A employee records or payroll entries.
12. Unreleased payroll rejects attempts to generate government filing evidence.

## Coverage limits and integrity
PF-01..PF-22 is broader than this smoke test. The report records per-case APP_OBSERVED_SYNTHETIC, NEGATIVE_GATE_ONLY, PURE_FUNCTION_SYNTHETIC and NOT_RUN. It does not claim all 22 passed.

This test does NOT demonstrate real leave approval, governed compensation, retroactive corrections, duplicate punch correction, statutory agency acceptance, 100-worker released remittance packages, physical-device evidence or genuine independent human UAT.

Separate nine-stage fictional tests can generate four draft filing worksheets after approved record release in a different disposable tenant; they cannot be treated as acceptance for this 100-worker cohort.

Real employer reconciliation #579, independent WFM UAT #691, employer journey #853 and external government/bank evidence #192 remain open gates. Do not merge or activate any financial capability based on this test alone.

## Running and reading results
A pull request against main triggers the isolated workflow. Inspect its exact-commit status and uploaded sanitized competitive-100-worker-synthetic-preflight artifact.

PASS_SYNTHETIC_PREVIEW_ONLY means the evidenced checks passed without payroll release, money or government filing.
FAIL_SYNTHETIC_BENCHMARK means reproduce and repair the failure; do not weaken policies to make it pass.
Absent report or aborted workflow means NOT_RUN.

Vendor results remain NOT_RUN until independently observed in an authorized PH-relevant sandbox or witnessed product demonstration. No invented vendor ratings.

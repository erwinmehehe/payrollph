# WFM consolidation receipt

## One existing delivery PR

The owner requested finishing and consolidating the existing WFM work rather than opening more feature PRs. PR #702 is the single integration PR. No new feature branch or PR is required for this consolidation.

| Source PR | Preserved work | Original source head |
| --- | --- | --- |
| #690 | Live Floor and Team Roster tenant/request isolation; pilot acceptance matrix | `2f8364ff20d9aa0215d7bad58e03e18541d1bcae` |
| #702 | Governed batch staging, independent checker, atomic schedule/audit changes and shared roster locks | `1a821bb7caee4227b97a8f5ee425b99f04a45b89` |
| #713 | Strict, server-only employer allowlist for both batch API methods | `d6e78494ed3ba555f21b046440a44256dcbc019d` |
| #718 | Employee upcoming-week view, Philippine dates, unassigned/rest distinction and superseded-request protection | `1d6addb0f7657406ef3871a80c651141a4db67aa` |

The #713 history was fast-forwarded into #702. #690 and #718 were merged into the same integration branch with their original commits retained. The companion PRs can therefore be closed as incorporated, without deleting any branches or discarding source changes.

## Mainline compatibility

The consolidation also incorporates main commit `1573866e74b3ea132d13eb5e778599ee01985b0c`. In particular, it retains the tested legacy-workspace signup-table hotfix from #717. The three hotfix files are copied by exact Git blob SHA, not rewritten.

## Verification before main merge

- Run the full exact-head CI, TypeScript check, existing PostgreSQL isolation/rollback tests, golden payroll checks and production build.
- Run the new consolidation contract tests alongside the source PRs' regression tests.
- Preserve the review-queue limit rather than editing or disabling its policy.
- Preserve all remaining payroll, payout, HCM, tax and ESS work outside this WFM integration. Moving a later review item to draft does not delete its code or approval history.

No independent human review, statutory certification, real-employer acceptance, or production database migration is established by this receipt. CI results must be taken from the exact final commit, not the individual historical branches.

## Activation remains a separate decision

`WFM_BULK_ROSTER_PUBLISH_ENABLED` remains disabled by default. The batch endpoints additionally require explicit `WFM_BULK_ROSTER_ALLOWED_ORGANIZATION_IDS`, and the optional UI has its own flag. This consolidation does not set any environment variables, allowlist employers, publish shifts, release payroll, send payments, or apply migration 0107 to a live database.

The cross-source HR/leave/attendance/payroll race and independent pilot-review gates in `wfm-governed-bulk-roster-pilot.md` remain prerequisites for real-employer activation. Main may auto-deploy after merge; deployment and the six-persona live smoke must be checked separately from source integration.

# HCM Organization & Positions Explorer — read-only staging acceptance

**Status: draft code only.** This is not a compliance certification, real-employer UAT, or approval to deploy. Related issue #709; Worker 360 dependency is tracked separately in #700 / PR #701.

## Source and architecture

- Uses existing current org_units, positions, job_profiles, and effective-dated position_assignments records. No separate mutable worker master, positions table, or org structure.
- Org-unit parents are read from org_units.parent_id; missing links, inactive/effective-dated parent gaps, and cycles are explicitly identified. Do not silently promote a missing/cyclic parent to a healthy root.
- Active org-unit snapshot uses Asia/Manila date and existing active/effective date fields. Position source is a present-day mutable snapshot, not historical organization/job title evidence.
- Position counts are **records by mapped supervisory org unit** (fallback administrative org unit), not certified headcount, filled seats or vacancies.
- An assignment-history record includes a worker identifier only when that employee belongs to the explicitly requested employer. Otherwise the worker link is unverified and the employee ID is omitted.
- The full organization graph refuses to load if more than 250 active org units or 500 positions are returned. No truncated source may be called complete; the product needs paged drilldowns for employers larger than these pilot ceilings.
- Position assignment history fetches at most 51 records and displays 50, labeled as incomplete when another exists.

## Default-OFF activation and rollback

- Server-only HCM_ORG_EXPLORER_ENABLED=true gates the GET APIs and the server-rendered page.
- Build-time public NEXT_PUBLIC_HCM_ORG_EXPLORER_ENABLED=true shows the People workspace shortcut to authorized HR operators only; the client flag **is not** an authorization mechanism.
- Both flags remain unset for production. A release owner may set them in protected synthetic staging only after reviewed permissions and query plans. Turn off the server flag and redeploy to disable access; hiding the navigation alone is insufficient.
- No SQL migrations, worker writes, position writes, BP actions, payroll calculations, payout, or bank functionality.

## Security / correct-account scenarios

| Synthetic scenario | Expected |
| --- | --- |
| Company-wide owner/admin/HR with People admin permission | May view **explicitly requested** employer |
| Bookkeeper, payroll-only, checker, manager, employee, branch-scoped HR | Denied server-side |
| Owner/admin/HR with custom People admin deny | Denied server-side |
| User in company A queries company B, whether same unit/position numeric IDs exist | Denied |
| User authorized to two employers switches rapidly with delayed responses | Only data matching requested employer; old fetch aborted/ignored |
| Position ID belonging to employer B requested under A | 404, no position or history leaked |
| Source position assignment has employeeId foreign to current employer | Worker reference null/unverified; no other tenant's worker identifier |
| Position refers to org unit not in active tenant snapshot | Relationship flagged; no foreign unit reference exposed |
| Orphaned unit parent and cyclic links | Flag source integrity instead of invented tree link |
| Missing job profile title | Explicit unknown; no guessed title |
| More than 250 active units or 500 positions | Refuse full graph; no fabricated "complete" totals |
| More than 50 assignment histories | Show 50, hasMore=true; no total or completion claim |
| Mobile / keyboard / zoom / screen-reader | Semantic headings, labelled interactive units, selected state, loading/error/preview states |
| Payroll and HCM business-process operations | No changes to payment or governed mutation paths |

## Review gates

- [ ] Exact-head TypeScript, unit/static regression suite, Next build, lint, security/CodeQL, payroll isolation and SQL history controls pass.
- [ ] HR/HCM reviewer validates supervisory unit vs administrative unit and position reference semantics.
- [ ] Security reviewer validates tenancy, role, custom deny, field scope and employer-switch race handling.
- [ ] DBA reviews bounded query plans, active effective-date filters, join by same organization and source index usage.
- [ ] QA performs two synthetic-employer protected staging test scripts, invalid IDs, orphaned/cyclic relationships, full-preview ceilings and failed source responses.
- [ ] Accessibility/mobile screen review, release flag rollback rehearsal, recorded independent UAT and release-owner sign-off.
- [ ] Only then consider production rollout, separately from payroll provider or real employer acceptance.

## Follow-on

- Paginated multi-organization scale (not a naive unbounded all-records graph).
- Versioned historical manager/organizational hierarchy snapshots where authoritative event evidence exists.
- Business Process Monitor (source-linked HCM workflow instances, pending approvers, step SLAs, and delegated workflow state) in its own guarded phase. Do not auto-approve HR or payroll transactions.

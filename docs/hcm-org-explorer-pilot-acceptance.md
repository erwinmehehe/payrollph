# HCM Organization & Positions Explorer — read-only source acceptance

**Status: pre-client source integration.** This is not a compliance certification, real-employer UAT, or approval to enable production. Related issues: #709, #700 and #734. Existing Worker 360 source has since merged as #701.

## Source and architecture

- Uses existing current org_units, positions, job_profiles, and effective-dated position_assignments records. No separate mutable worker master, positions table, or org structure.
- Org-unit parents are read from org_units.parent_id; missing links, inactive/effective-dated parent gaps, and cycles are explicitly identified. Do not silently promote a missing/cyclic parent to a healthy root.
- Active org-unit snapshot uses Asia/Manila date and existing active/effective date fields. Position source is a present-day mutable snapshot, not historical organization/job title evidence.
- Position counts are **records by mapped supervisory org unit** (fallback administrative org unit), not certified headcount, filled seats or vacancies.
- An assignment-history record includes a worker identifier only when that employee belongs to the explicitly requested employer. Otherwise the worker link is unverified and the employee ID is omitted.
- The full organization graph refuses to load if more than 250 active org units or 500 positions are returned. No truncated source may be called complete; the product needs paged drilldowns for employers larger than these pilot ceilings.
- Position assignment history fetches at most 51 records and displays 50, labeled as incomplete when another exists.

## Default-OFF activation and rollback

- Server-only `HCM_ORG_EXPLORER_ENABLED=true` **and** the exact legal employer ID in `HCM_ORG_EXPLORER_ORG_IDS` are required for either GET API or the server-rendered page. Absent or malformed allowlists deny access.
- Build-time `NEXT_PUBLIC_HCM_ORG_EXPLORER_ENABLED=true` and exact employer ID in `NEXT_PUBLIC_HCM_ORG_EXPLORER_ORG_IDS` show the People workspace shortcut to company-wide HR operators only. Client visibility never replaces server authorization.
- All flags and allowlists remain unset in production. Pre-client source code may merge after exact-head CI and maintainer review **without** a dedicated staging project. Later real-employer feature activation requires separate HR/privacy/security/QA release reviews and operator sign-off. Turn off the server flag and redeploy to disable data access; hiding navigation alone is insufficient.
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

## Pre-client source integration gates

- [ ] Exact-head TypeScript, unit/regression suites, Next build, lint, CodeQL, payroll isolation and SQL history controls pass.
- [ ] Maintainer diff review of tenant predicates, 250/500 record caps, 50+1 history cap, absence of salary/PII, immutable read-only routes, employer allowlist and request cancellation.
- [ ] Synthetic two-employer QA, invalid ID and unauthorized role tests. No real employee data or production database needed.

## Separate real-employer activation gates — not required for source merge

- [ ] HR reviewer validates supervisory versus administrative units and position reference semantics.
- [ ] Security/privacy reviewer checks session/deny-only overrides, role downgrade, field minimization and employer switching.
- [ ] Data reviewer checks bounded plans, filters, joins and indexes against a realistic authorized dataset.
- [ ] QA verifies two employer contexts, errors, capped previews, accessible keyboard/mobile operation and screen reader labels.
- [ ] Release owner records deployment SHA, exact employer allowlist, rollback rehearsal and permission to enable.
- [ ] Production operational privacy and payroll release readiness are assessed separately; code merge never means employer activation.

## Follow-on

- Paginated multi-organization scale (not a naive unbounded all-records graph).
- Versioned historical manager/organizational hierarchy snapshots where authoritative event evidence exists.
- Business Process Monitor (source-linked HCM workflow instances, pending approvers, step SLAs, and delegated workflow state) in its own guarded phase. Do not auto-approve HR or payroll transactions.

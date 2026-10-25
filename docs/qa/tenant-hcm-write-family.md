# HCM family: seven pending exact-method proofs

This independent main-based batch does not include People/platform PR #1402.
All seven methods remain GAP until actual HTTP/PostgreSQL acceptance. A local
assertion test, successful build or prepared fixture is not coverage credit.

| Method | Exact own scenario |
| --- | --- |
| POST hcm/employment-terms | Request regular terms; leave pending approval |
| POST hcm/employment-term-decisions | Request continue-current against active terms; verify its requested event |
| POST hcm/effective-changes | Create a future pending unit-change request and its linked business process |
| POST hcm/capabilities | Link an own job profile to an own skill requirement |
| POST hcm/business-processes/definitions | Disable an existing fictional hire definition |
| PATCH hcm/work-items | Assign an own operational case and verify its ownership event |
| GET hcm/work-items/events | Read the exact seeded case event, actor and marker |

The six writes require exact persisted own identities, employer, actor and domain
values. Every write has a real victim request and an own-employer/foreign-resource
forgery. The shared runner retains two independent attackers, discrimination and
unchanged victim target rows plus shared database/audit snapshots. The read proves
the exact seeded event and actor rather than accepting an empty list; its foreign
organization request must be denied. This read does not add separate acceptance
for every same-employer case-filter branch.

The work-item event table is SQL-only in existing migration 0104 and absent from
the Drizzle schema. A dedicated fixture installer executes that exact checksum-
pinned existing migration only in GitHub Actions, with the exact disposable
localhost app_db URL and payouts disabled. It verifies database/user/version,
locks and verifies zero employers/audit records before DDL, and rolls back on
failure. It runs after the reviewed baseline and before build/server/seeding.
It does not change or apply a production migration, application schema or guard.

Only the default fixture profile executes these rows. Multi-entity HCM execution,
term activation, approval decisions, manager attestations, provider delivery,
production audit proof and payroll acceptance remain outside this batch. The
workflow-definition fixture uses process type hire so it cannot alter the
effective-change scenario's change-job policy. Existing rows and curated proof
provenance are preserved; link-only refresh adds no method credits.

Before credit: inspect the exact-head real HTTP/PostgreSQL result for all seven
methods and all three table profiles, fix any failure, generate reviewable method
credits in this PR, then require fresh CI on the final head. No automatic merge.

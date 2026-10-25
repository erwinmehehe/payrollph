# People/platform write-family isolation batch

This batch adds 12 exact-method scenarios to the existing disposable PostgreSQL
and localhost HTTP runner. All 12 remain GAP until actual HTTP acceptance; local
fixture tests are not HTTP evidence or coverage credit.

| Method | Bounded own operation |
| --- | --- |
| PATCH discipline | Submit a fictional employee explanation |
| PATCH provisioning | Complete a fictional onboarding task |
| POST dynamic-worker-groups | Rename an inactive draft group |
| POST recruitment | Create a fictional applicant for an existing requisition |
| PATCH recruitment | Change applicant notes only |
| POST delegations | Create a delegation between same-employer fictional members |
| POST it-operations | Request an application grant; no remote grant |
| PATCH it-operations | Record a requested revocation as revoked; no provider call |
| POST workforce/worksites | Create a worksite linked to the own organization unit |
| PATCH compliance/data-requests | Record triage notes and in-progress status |
| POST approval-chains | Revise an inactive draft policy |
| POST integration-connectors | Disable an existing fictional connector record |

Each row verifies the persisted own identity, employer and domain values, not
just HTTP 2xx. The shared runner exercises two independent attackers, real victim
IDs, forged references where applicable, discrimination, unchanged victim target
rows and the shared victim/audit snapshot. Connector responses deliberately omit
employer and credential fields; that row binds response ID to the verified own
database row and checks employer on both before/after snapshots instead.

Recruitment covers the existing default-profile privacy-flag-OFF path, not hiring
or privacy-flag-ON branches. Group and approval-policy updates remain inactive.
Connector disabling touches only synthetic stored configuration and makes no
provider request. These scenarios do not certify every branch of a method.

The branch separately reconciles three already executed Performance credits from
PR #1393, with its exact-head HTTP run receipt in
[the Performance evidence note](tenant-performance-write-family.md). Those three
are not part of the 12 new target methods. `tenant-table-credit.mjs --only-key`
restricts new credits to explicitly selected catalog methods; unknown/duplicate
keys fail. Existing proof provenance and source pins are refreshed as usual.

Before adding these 12 credits: inspect the real default write-job result and all
three profiles on this PR head, correct any fixture failure, generate the credits
for successful exact methods, update this document and the GAP assertions, and
require fresh CI on the final reviewable head. No production SQL, real employer
data, external services, money flags or authorization/audit guards are changed.

# HCM Process Monitor — tenant-bound SSR process IDs (2026-11-10)

**Review status: DRAFT / ZERO COVERAGE CREDITS / NOT SECURITY ACCEPTED.**

## The bounded page authorization change

The read-only `/hcm/process-monitor` page already checks one selected employer, a feature-ON employer allowlist, authenticated People/admin role permissions, company-wide scope and its opted-in plan gate. Its underlying SQL loader already qualifies process and step reads by employer.

The missing page boundary was the optional `processId` selector: a caller could send the ID of an existing *foreign employer's* workflow while keeping an otherwise authorized `organizationId`. The loader returned an in-page "not found" detail while still returning **HTTP 200** with other own-employer results. This is a response-status and object-ownership hardening gap; there is **no established foreign-process data leak** in the existing employer-filtered loader.

The page now verifies the selected process exists with both `hcmBusinessProcessInstances.organizationId` and `hcmBusinessProcessInstances.id` **after** the existing employer role and permission gates and **before** querying or rendering the timeline. It calls `notFound()` for foreign and missing IDs, including raced deletion, and rejects repeated or malformed query selectors instead of silently falling back to the "all" status. An unselected process still renders the authorized list. Source outages remain unavailable/error, not healthy zeros.

The underlying `GET /api/hcm/process-monitor` and SQL projection are **unchanged**, so this PR does not claim API-method acceptance, multi-entity legal-employer acceptance or write-action permissions. The monitor remains a read-only, feature-flagged view; approval/workflow mutations stay in their governed endpoints.

## Disposable real-HTTP proof

`.github/workflows/tenant-hcm-process-monitor-ssr-qa.yml` runs a **fictional PostgreSQL 16** instance, a 127.0.0.1-only production Next server, and a source-pinned HTTP fixture. The runner refuses missing/mismatched guard variables, live/remote database or app URLs, external provider credentials, provider/money flags and changed source blobs **before importing DB/app modules**. Test employer allowlist is fixed to three known fresh IDs.

It requires:

- Two independently signed-in owners with populated own process lists and actual selected-process timelines, including one existing approval step and a stored approved status.
- A genuine later-ID victim with persisted processes and steps; both attackers must get hard **404** for a foreign employer and for the victim's real process ID supplied under an owned employer.
- Repeated employer, status, process and cursor selectors; malformed/nonexistent IDs; a foreign-ID cursor that cannot widen the employer source.
- A company-wide bookkeeper, unit-scoped HR, group-HR and anonymous caller denied; a revoked membership denied while the account session remains valid.
- Exact unchanged employer, employee, HCM process, step, payroll-run and audit SQL snapshots after read/denial cases.
- A deliberate disposable process-table failure: selected process fails closed and unselected read shows **source unavailable**, not an empty-workflow all-clear.
- Static source and negative-unit contracts plus the existing monitor unit tests.

**Uncredited:** The scoped page remains **GAP** pending exact-final-head real-HTTP CI success and independent security/privacy and product-owner review. No change to API-method counts or page credits. Any future HCM multi-entity legal-employer scoping is separate and unaccepted.

No real people, Neon access, live credentials, external network/provider calls, migrations, money movements, payroll approvals, release flag changes, deployment or merge is authorized.

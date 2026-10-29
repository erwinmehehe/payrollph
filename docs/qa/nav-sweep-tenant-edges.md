# Navigation runtime sweep: cross-employer edge proof

**Status: DRAFT, zero tenant-isolation coverage credits, not accepted for production.**

The existing Navigation runtime error sweep exercises real Playwright browser navigation for role-scoped menus on desktop and mobile. It runs the full derived role/page/viewport matrix on main, nightlies and manual dispatch, plus a focused browser set on PRs. This extension adds a **separate read-only 21-page employer-ID HTTP matrix** on every matching PR and main run. It does not change production page handlers, authentication policies, permission rules, the app navigation inventory, or the tenant-isolation classification.

## Exact evidence

- Use only ephemeral PostgreSQL 16 on 127.0.0.1:5432/app_db. The existing navigation fixture and role accounts must already exist. All employer identities and sessions are fictional. CI, synthetic-only mode, a local-only application origin, disabled workers, schedulers, billing/payout integrations, and absence of live provider credentials are enforced **before importing any application/database module**.
- Seed two independent owner and employee sessions (ATTA, ATTB), followed by a genuinely persisted **higher-ID victim** employer (VICTIM), worker, employee-only private record and fictional draft payroll row. Verify three distinct owners and six disjoint sessions.
- For both attackers, request their own employer and the victim employer using real authenticated GETs for **all 21 scoped page/action URLs from the authoritative tenant-isolation manifest**. Every observed status must be below 500. A real victim-only employee ID, payroll marker, and private employer name may not appear in any foreign response. The public careers entry receives a narrow exception for a published employer name, **not** private employee or payroll records.
- The normal `/app?organizationId=` own source must be 200, HTML, with a **real persisted employer name and private worker marker**, not a 200 error shell. A copied high-ID foreign `/app?organizationId=` must be exact 404 for each attacker.
- Snapshot actual SQL employer, worker, pay-profile, payroll, staffing, membership, outbox and audit business state for **all three employers** before any navigation. All 42 cross-employer comparisons must preserve these records. Session last-seen fields are excluded, because legitimate authenticated reads can refresh a session timestamp.
- Finally revoke attacker A's real employer membership without deleting its still-valid session. The same actor must receive exact 404 when opening the previously accessible employer URL; A's business/audit records and every victim/B record stay unchanged.
- Write a **separate** machine-readable JSON and Markdown receipt under `qa-artifacts/nav-sweep/tenant-edges.*`, which the existing workflow uploads. The report does not replace the role/viewport report, the manifest, browser screenshots or the independently reviewed tenant-isolation inventory. The HTTP client uses a reviewed exact-route localhost allowlist checked against all 21 manifest paths. Reports store bounded literal status codes and approved inventory metadata, never response bodies or unchecked network strings.

## What this does not prove

A feature-disabled 404, unauthenticated redirect, or generic HTML 200 does **not** count as a positive for any of the other individual pages. This route matrix is **exploratory** for the 17 outstanding page/action GAPs and does not test all interactive page actions, posted mutations, client-side employer switching races, all enterprise feature toggles, or release/payroll authorization. It must never be used to award a new COVERED method or page classification. The existing global tenant-isolation release remains **NO-GO**.

## Validation and next decision

- [ ] Exact-PR-head fail-closed and negative-control source tests pass.
- [ ] PostgreSQL 16 seed, both own-workspace positive HTTP receipts, all 42 page comparisons, unchanged victim SQL, and revoked-owner 404 pass.
- [ ] Existing Settings and mobile real-Chromium navigation, deliberate broken-route/overflow negative controls and relevant CI pass.
- [ ] Independent owner and security/privacy reviewers evaluate any unexpected page result. Any failure is investigated rather than allowlisted.
- [ ] Separate scoped-page browser/action adapters and reviewed evidence must precede any GAP promotion.

No production deployment, provider connection, live account access, or auto-merge is authorized by this draft.

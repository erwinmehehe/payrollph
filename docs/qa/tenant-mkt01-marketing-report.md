# MKT-01: Marketing operator report privacy boundary

**Distinct family**: platform marketing analytics, not payroll, year-end/tax, billing, private documents, enterprise administration, account email, or workforce planning. This draft starts from main and edits ONLY these five new files: a dedicated workflow, contract, real-HTTP runner, test and this note.

## Exact surface

- GET /api/marketing/leads, source blob 69a046c25fb59ccc75c47b41d44c26b585e898b3
- Supporting src/lib/marketing-report.ts, source blob 7371a252be449829b09e7a0ff501d77eb6d811fd
- The reporting endpoint intentionally aggregates **platform marketing enquiries**, not tenant-private employee or company objects. Its access boundary is an exact configured fictional email allowlist plus recent session-level MFA.
- It remains **GAP with testedBy:null** in the shared tenant-isolation inventory. No new method COVERED credit, transfer of tenant proofs, independent acceptance or production certification.

## Disposable proof matrix

In a brand-new, empty localhost PostgreSQL 16 database and an actual Next production build:

1. Create three fictional organizations and three real, separate signed-in owner identities; victim organization/user IDs are higher than both comparators. No real emails or provider credentials.
2. Insert three recent fictional demo/trial marketing leads plus an older excluded lead. Names, email addresses, companies and messages are unique private sentinels; the report must return only grouped counts and approved marketing dimensions.
3. Anonymous GET is 401. Valid fresh-MFA user not in the operator allowlist is 403. Allowlisted but 48-hour stale-MFA user is 403 / MFA_REQUIRED. Legitimate allowlisted, freshly MFA-verified operator GET is 200 with real aggregate counts.
4. Requested report days clamp to the reviewed [1, 365] interval; malformed days use 90. A 400-day-old lead never appears.
5. The accepted JSON must never contain the sentinels for prospect names, email addresses, companies, or notes. Compare durable marketing leads, organizations, memberships, audit events and payroll runs before and after all HTTP probes.
6. Revoking the allowed user's real session makes the same cookie return 401, while all lead and payroll snapshots remain byte-identical.

**Scope limitation**: this test does NOT certify that every free-text UTM or URL segment is de-identified; the real report groups attacker-supplied campaign dimensions and requires separate privacy review before broad exposure. It is not a per-employer isolation proof. No production read, email delivery, payout, external HTTP provider or worker job is authorized.

## Isolation from other open PRs

The PR never edits production routes, marketing helpers, authentication, the manifest, tenant-table rows, shared test suites, migrations, money paths or provider keys. GitHub must confirm the five new paths do not overlap ANY open PR before merging. Exact-head PG16 CI and independent security/privacy approval are still required.

**NOT ACCEPTED. Draft only.** Successful synthetic proof is not deployment permission, a global tenant security certificate or new coverage credit.

## 2026-11-12 candidate upgrade — DO NOT CREDIT YET

The initial merged #1848 proof produced a successful fictional PG16 HTTP run on a historical PR head but expressly granted zero credits. This renewed runner adds a *second real signed-in allowlisted operator success* after proving stale-MFA denial, real higher-ID forged `organizationId`/`employeeId`/`runId` query parameters, and an attempted `format=raw` override. The JSON report must remain byte-consistent except for the generated `since` timestamp. The unallowlisted higher-ID outsider must still be 403, and durable lead/employer/audit/payroll snapshots must remain unchanged.

**Credit gate stays closed** until this candidate passes on its exact final PR head and the separate method-specific source/workflow/CI receipt and shared ledger accounting are reconciled and accepted. The API aggregates platform-wide marketing requests by design. It is not a tenant-private employer read. Free-text UTM/campaign and landing-path values are not fully de-identified by this test; independent privacy/security review remains PENDING. No merge, deployment or production authorization is implied.

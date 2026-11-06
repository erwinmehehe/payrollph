# DEV tenant isolation: developer API keys (POST) — proof candidate, zero credit

## Selection and separation

**Family:** DEV (developer API credentials). Target: `POST /api/developer`, specifically
`create-key` and `revoke-key` actions. This is a distinct route, data domain and workflow from
all open PR families at the time of creation: account password/logout, SAML/IdP,
staffing policies, overnight payroll, managed-payroll client approvals and company exports.
No shared tenant coverage manifest, application route, auth utility, CI/security HTTP workflow,
feature flags or production data are changed.

The method currently remains **GAP** in `scripts/qa/tenant-isolation-coverage-manifest.json`.
Because `create-webhook` and `test-webhook` are separate actions and deliberately
**not executed**, this is *partial proof only*. It is not proof of complete POST method coverage.
There are **zero new coverage credits** and no status/classification changes.

## What the dedicated executable checks

The new path-scoped workflow `.github/workflows/tenant-developer-key-http.yml` builds a
production-mode Next.js server at **127.0.0.1 only**, backed by an empty disposable
**PostgreSQL 16** instance `app_db`. The runner refuses any non-GitHub-CI target, a
production/external DB, live provider tokens, worker/payout/billing flags or real data.
Synthetic sessions, own-employer staff and keys are inserted in SQL; no production
credentials, webhooks, providers or payroll releases are touched.

For **two independently authenticated employer owners**:
- Prove successful own `create-key` with an actual fresh SQL row, one-time token whose
  SHA-256 matches the stored hash, allowed scopes and an owner-specific audit receipt.
- `GET /api/developer` lists only own key prefix/metadata without the plaintext key,
  hash, victim key/webhook metadata or secret.
- Forged body `userId`, `employeeId`, `targetOrganizationId` and `keyId` cannot direct
  the key creation away from the signed-in employer.
- A **real victim key** (higher ID than six, belonging to a separate populated, higher-ID
  victim employer) cannot be revoked. Its 404 is byte-identical to a nonexistent key's
  404, while selection of the victim organization in GET/POST denies with 403.
- Cross-origin attempts, unit-scoped administrators and revoked active memberships
  deny. Membership revocation is checked using the **same still-authenticated session**.
  Denied probes add no credentials, webhook endpoints or audit receipts.
- A legitimate owner can revoke **their own** newly created key and gets one matching
  audit receipt, while the victim's key, sessions, staff, memberships, webhook metadata,
  key hashes and audit rows remain unchanged in PostgreSQL.

The runner **does not print any one-time API token** or include sensitive HTTP bodies in
errors or uploaded artifacts. It seeds a fictitious victim webhook endpoint only as an
immutability sentinel, never sends a webhook.

## Evidence, review, and acceptance

Source-only executable tests:
`node --test tests/tenant-developer-key-contract.test.mjs`

Real PostgreSQL/Next workflow:
`Tenant Developer API-key POST (fictional PG16 HTTP, zero credit)`.

- [ ] Exact final-head workflow runs successfully and supplies the PASS receipt.
- [ ] Applicable CI, CodeQL, security HTTP and source-inventory checks pass.
- [ ] Maintainer inspects changed-file scope, no overlap, fixture safeguards and rollback.
- [ ] Security/coverage owner separately decides whether further action variants,
      independent review and evidence support any future ledger classification.

**Never re-pin or promote the existing POST method on source-only tests.** Older
developer helper database unit tests establish transaction/audit atomicity, but not
real two-session route-level tenant isolation. This dedicated HTTP run is additional,
not a substitute for existing checks. A passing workflow does not authorize a
live API key, integration, deployment, payment or production payroll.

**Rollback:** revert only this isolated proof commit. No migrations, app source
changes, provider activation, payroll calculations, bank or payout transfers.

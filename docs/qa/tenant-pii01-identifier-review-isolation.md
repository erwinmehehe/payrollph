# PII-01 — Employee identifier review tenant isolation (draft, NOT ACCEPTED)

## Provisional scope
Two previously unproven method signatures: `GET /api/employee-identifier-requests` and `POST /api/employee-identifier-requests`. This work adds method-specific evidence, **not** a blanket tenant-isolation certification or a government-ID verification approval. All other PII-01 routes remain unchanged and unproven unless separately evidenced.

## Disposable real-HTTP controls
The new [three-employer proof](../../scripts/qa/tenant-pii01-identifier-review-http.mjs) runs only in the existing Security HTTP Smoke job with `CI=true`, `TENANT_SECOND_PASS_MODE=isolated-ci-only`, production-mode localhost HTTP on `127.0.0.1:3000`, disposable PostgreSQL 16 `app_db`, and an ephemeral PII encryption key. It refuses production payment keys/providers and never contacts an agency.

- Legitimate own GET: each of two independent signed-in HR owner accounts reads its populated pending requests (200), including its own employee IDs and masked fictional identifiers.
- Foreign GET: each attacker sends a real victim `organizationId` and receives 403. A forged `employeeId` under its own organization cannot change which employer's pending rows are returned.
- Legitimate own POST: each owner rejects a real pending request with the existing recent-MFA requirement (200). The rejection is persisted with its real reviewer ID, and no government identifier is applied.
- Foreign POST: each attacker sends the victim organization's actual pending request and receives 403; sending the real higher-ID victim `requestId` under its own organization returns 404. A separate forged victim `employeeId` paired with a real own request must decide only the owned row.
- Persistence and non-disclosure: eight real victim pending requests are seeded after the attacker-owned rows. Their request IDs exceed both attackers' owned IDs and six. Full victim request/identifier/employee/audit/payroll PostgreSQL snapshots are deep-equal before and after attempted foreign/forged reads and writes. Response bodies and headers cannot include victim-only identifiers.

The identifier-review route requests `Cache-Control: private, no-store`, while the deployed Next.js API-wide header policy emits `no-store, max-age=0`. The real-HTTP proof checks that the **actual response** contains `no-store` without `public` or `s-maxage`; it does not require the framework to retain the route-level `private` token. No identifier response may be cached.

## Source-pinned ledger

| Method | Own positive | Foreign denial | Forged selector | Victim unchanged |
|---|---|---|---|---|
| GET | [L140](../../scripts/qa/tenant-pii01-identifier-review-http.mjs#L140) | [L151](../../scripts/qa/tenant-pii01-identifier-review-http.mjs#L151) | [L157](../../scripts/qa/tenant-pii01-identifier-review-http.mjs#L157) | [L196](../../scripts/qa/tenant-pii01-identifier-review-http.mjs#L196) |
| POST | [L167](../../scripts/qa/tenant-pii01-identifier-review-http.mjs#L167) | [L176](../../scripts/qa/tenant-pii01-identifier-review-http.mjs#L176) | [L181](../../scripts/qa/tenant-pii01-identifier-review-http.mjs#L181) | [L196](../../scripts/qa/tenant-pii01-identifier-review-http.mjs#L196) |

**Provisional main-based ledger:** 154 method COVERED, 10 PUBLIC-BY-DESIGN, **330 GAP** among 494 API methods; **18 page/action GAPs** remain. The separate open PR #1355 has six additional MNY-02 method proofs not counted here. A later reconciliation must preserve unique method identities and must not double-credit them.

## Merge and acceptance gates
- Security HTTP Smoke must run the actual request/PG16 proof on this exact head (the source-only test is insufficient).
- CI regression shards, typecheck and security checks must pass on this exact head; preserve the server's existing privilege, origin, MFA, and rate-limit protections.
- Independent security-owner review must approve the precise GET/POST method evidence and confirm that unknown PII methods remain GAP.
- No production data, real secrets, statutory acceptance, feature flag, migration, payroll calculation/release or provider request is authorized by this proof.

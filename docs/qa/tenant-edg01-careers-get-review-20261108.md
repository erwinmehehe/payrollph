# EDG-01 public Careers GET — review-only real-HTTP proof expansion

**Scope:** [issue #1740](https://github.com/erwinmehehe/payrollph/issues/1740), `GET /api/careers` only. Zero new API credits. `GET` and `POST /api/careers` both remain `GAP` on this branch. No code route, migration, coverage manifest, flags, providers, payroll or production data are changed.

The existing `tenant-edg01-careers-publication-http.mjs` workflow creates three independent fictional employers with two real attacker employers and one higher-ID victim, real published/draft/closed requisitions, fictional private applicants and unrelated draft payroll rows in disposable PostgreSQL 16. This PR extends that **existing** integration runner:

- Before any publication, anonymous `GET /api/careers?organizationId=<ID>` returns an empty list for each real employer. No draft or closed job is exposed.
- After each independent owner publishes their own real open job, anonymous GET returns only that employer's public job with the exact five allowlisted public fields; no other employer's marker, applicant email or private applicant record is exposed.
- Following the two attackers' legitimate unpublishes, both public lists empty while the higher-ID victim's published job remains visible.
- Snapshot assertions require every GET to leave employer, applicant, audit, and draft payroll SQL rows unchanged; success responses require `no-store`.
- Source-contract tests refuse the claim that this test grants a tenant isolation credit or independent security review.

Public Careers listings are intentionally **anonymous and employer-selectable**, so a real foreign-company GET may correctly return another employer's published openings. That is **not** a tenant-private 403 and must never be called such. A future `PUBLIC-BY-DESIGN` credit, if appropriate, needs a dedicated public data/privacy review after the exact-head real-HTTP and source-contract CI jobs pass.

**Execution:** the existing `.github/workflows/tenant-edg01-careers-publication-http.yml` runs on edits to the harness or contract tests. It uses a localhost Next server with disposable PG16 and no real providers. Test status is **NOT RUN** until a GitHub Actions run proves otherwise. This is neither production permission nor statutory/payroll certification.

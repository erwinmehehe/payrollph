# EDG-01: public Careers applicant POST — standalone tenant-pairing proof

**Status:** DRAFT, zero API-method credits, independent security/privacy review pending. Issue [#1740](https://github.com/erwinmehehe/payrollph/issues/1740); canonical target is **POST /api/careers**. This PR does not change runtime routes, migrations, application flags, existing source-pinned PATCH or GET proofs, or the tenant coverage manifest.

## Why this is a separate family

This is an anonymous, public recruitment intake endpoint. It is not a signed-in employer-private route: a member of the public can intentionally apply to a published position of any employer. A 403 for a correctly selected other employer would be an incorrect tenant-isolation expectation. The relevant isolation boundary is that an employer ID cannot be mixed with an existing other-employer requisition ID to insert a private applicant, consent-evidence record or audit event into the wrong employer's data.

This test family is separate from the currently open enterprise-admin, TOTP/workforce-planning, private-document upload and payroll-tax PRs. It adds only dedicated applicant-intake QA, its own workflow, tests and this runbook. The existing [EDG-01 publication PATCH proof](./tenant-edg01-careers-publication-http.md) is reused **only for its disposable optional-column bootstrap**; its source and existing credit are unchanged.

## Synthetic real-HTTP / PG16 acceptance cases

1. Require GitHub Actions CI, a brand-new empty local PostgreSQL **16** database named `app_db`, loopback-only production-mode Next, verified synthetic flags and no real provider credentials. The only schema extension is the existing reviewed careers-publication SQL proposal, applied to this disposable DB.
2. Create two independent fictional attacker employers and a genuinely higher-SQL-ID victim. Seed distinct open published positions, closed jobs, prior applicants and consent evidence, plus one inert draft payroll run per employer.
3. Obtain a **real** `POST /api/intake-challenge` token for each synthetic email, solve its proof-of-work without bypassing the intake handler, and submit genuine public `POST /api/careers` requests. Each of three independent valid applications must return only `{ "received": true }` and persist exactly one same-employer applicant, one matching privacy-consent row and one redacted audit; all unrelated employers and draft payroll data remain unchanged.
4. For both attackers, deliberately mismatch a real victim requisition ID with an attacker employer ID and vice versa. The public endpoint must return a non-disclosing **404** and leave employer business rows unchanged. An unpublished/closed job must also be refused.
5. Duplicate application attempts must have the same public 202 receipt **without** a second applicant/audit. Reuse of a consumed security proof and submission without consent must be rejected, with no applicant writes.
6. Install a temporary trigger on `audit_events` in the **fictional database only**, using a nontransactional sequence to prove the actual audit INSERT was reached. The trigger deliberately fails that insert; the application, privacy evidence and audit transaction must roll back atomically. Remove the trigger and verify a fresh, valid application then succeeds.

The dedicated CI job generates one-time synthetic keys, builds the actual production-mode Next app, and runs against `127.0.0.1:3000`. It uses reserved RFC 5737 documentation addresses and a **CI-only simulated one-hop trusted proxy** to exercise independent rate-limit subjects; this configuration is not production guidance and must never be enabled for untrusted clients. No outside domains are contacted and no real applicant data is used.

## What a green result does and does not establish

A successful final-head run would be useful **provisional development evidence** of public employer/requisition pairing and applicant-privacy atomicity for this precise implementation and its disposable test setup. It is **not** proof that anonymous recruitment should use authenticated cross-employer denial, that all employers' recruitment data is isolated, or that any production migration/privacy notice has been approved.

`POST /api/careers` stays **GAP**. There is no method credit, no manifest/inventory edit, no production release, no provider interaction, no payroll calculation, no tenant-wide acceptance and no auto-merge. An independent security/privacy reviewer must inspect the exact-head result, the authenticity of the optional careers schema/notice, and the boundaries of any future status promotion. Changes to source files or main require fresh checks before merge.

**Rollback:** close or revert this test-only PR; it contains no runtime or production data changes.

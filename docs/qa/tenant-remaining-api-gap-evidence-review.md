# Remaining API GAPs — existing-evidence review and scoped closure decisions

**Review base:** `main@a9862149359524d23b48e776de6ad95aee031878` (2026-11-11).
**Status:** DRAFT / NOT ACCEPTED / **zero method credits** / NO ledger changes.
**Scope:** exact 17 remaining API method GAPs out of 498. On the reviewed base the manifest has
455 provisionally COVERED, 15 PUBLIC-BY-DESIGN, 11 PRIVILEGED-OPERATIONS-TOKEN-ONLY,
and 17 GAP. Sixteen separate page/action GAPs remain. These are inventory states,
not an independent tenant-isolation, product-security, identity or payroll certification.

## Decision: do not promote any of the 17 to tenant-private COVERED on existing evidence

The method contract in `scripts/qa/tenant-isolation-coverage-manifest.json` requires a
successful, nonempty **same-method** own HTTP response for two independent actual
employers; a persisted, higher-ID real victim-only target refused 403/404;
unchanged victim database/audit rows for writes; and forged selector containment.
Successful negative-only 401/403/404/429/501/503 responses, a passing unit test,
static handler inspection, a separate page proof, or a partial dispatcher action
are not a replacement. An anonymous/public route must not be mislabeled a
tenant-scoped COVERED route.

Only three **reviewable classification candidates**, not credits, can be
distinguished from the rest using the already-merged sources:

| Candidate | Source-backed current behavior | Proposed classification, NOT yet approved |
|---|---|---|
| GET /api/setup | Returns only `needsSetup` (global user count == 0) and `setupProtected`; no employer ID/request/employee selector, no private rows returned. Exact route SHA `9cf444640842e4bcdf0d8b6ad9912a5f68f34eaf`. | **PUBLIC-BY-DESIGN**, only if product/security owner explicitly accepts anonymous first-run state disclosure. This is not GET tenant isolation. |
| POST /api/intake-challenge | Anonymous email-bound HMAC challenge behind origin, default-OFF release flag, PostgreSQL-distributed IP/email limits and fail-closed unavailability. Handler SHA `7462f3e97e77b0862a0d6163e64857cbe13a950f`; helper SHA `7bb440c1151a7b43f3d713acf68db1cc6f6233a3`. Existing `tests/public-intake-proof.test.ts` and `tests/public-intake-proof-postgres.test.ts` cover HMAC binding/replay policy, not all live POST scenarios. | **PUBLIC-BY-DESIGN** candidate only after explicit public-token/anti-abuse/privacy policy review and (if accepted) exact-head route-level real HTTP checks. No employer-private credit. |
| POST /api/hcm/work-items/escalate | Requires `HCM_SLA_CRON_SECRET` before SQL; an authorized global sweep intentionally processes due cases for **multiple** employers. Events, recipients and dedupe keys carry their own organization; dedicated fictional PG16 proof exists in `scripts/qa/tenant-hcm-sla-escalate-http.mjs` and source SHA `b432d1331dac5c3da0c6a8bbc2b4c7ebe95ceb9a`. | **PRIVILEGED-OPERATIONS-TOKEN-ONLY** candidate only with independent operations/security-owner classification and exact-head review. This is NOT tenant-private access; a valid scheduler token can act across employers. Do not relabel it COVERED. |

The two proposed public candidates and the global scheduler classification would
reduce the GAP count **only after a separately reviewed and approved manifest
change**. Their classifications would contribute zero new tenant-private COVERED
methods. In this PR, all three **remain GAP with testedBy:null**. No owner
decision, accepted classification, successful final-head HTTP run, or reviewer's
signature is implied.

## The full 17-method disposition (no inherited credits)

| API GAP | Existing evidence / missing boundary | Current decision |
|---|---|---|
| POST /api/auth/saml/acs/[providerId] | Source-hardening makes disabled SAML providers uniformly refuse with no-store 503. There is no successful same-method SAML sign-in proof. | HOLD; negative-only, no credit |
| GET /api/auth/saml/metadata/[providerId] | Merged source-only and fictional PG16 anonymous XML proof (PR #1771; [run 42181922549](https://github.com/erwinmehehe/payrollph/actions/runs/42181922549)); disabled SAML provider IDs are observable via 200 vs 404. See `docs/qa/tenant-saml-metadata-public-proof.md`. | HOLD; **SAML metadata** public existence-disclosure decision PENDING, do not silently make public |
| GET /api/auth/saml/start/[providerId] | Uniform 503 disabled-runtime refusal, not successful identity assertion. | HOLD; disabled is not tenant proof |
| GET /api/auth/sso/callback | State consumption, provider code exchange and account linking require a complete mocked IdP positive and cross-employer/forged-state proof. | HOLD; identity/security review required |
| POST /api/auth/sso/resolve | Verified email-domain provider join now enforces same employer and has a fictional PG16 candidate. Anonymous discovery discloses enabled provider metadata; public policy and exact-head review remain unresolved. | HOLD; no anonymous discovery promotion |
| GET /api/auth/sso/start | Verified provider/domain check and OIDC state creation exist, but no full successful paired start/callback proof with unchanged victim state. | HOLD |
| POST /api/automation-studio | Existing source-specific triage and draft proof cover only subsets of a multi-action dispatcher; active PR #1918 is still partial relative to entire POST. | HOLD; all action branches need same-method proof |
| POST /api/hcm/work-items/escalate | Global multi-employer cron-token worker; tenant-attributed events/outbox. | **Token-only candidate**, not COVERED; approval required |
| POST /api/intake-challenge | Public non-tenant email-proof issuance when enabled; source-only and helper-level replay evidence. | **Public candidate**, not COVERED; approval required |
| GET /api/marketing/leads | Merged #1848 demonstrates an allowlisted MFA-scoped **platform-wide** aggregate (not a foreign-tenant report); grouped campaign/UTM dimensions need separate de-identification review. | HOLD; not public and not token-only without a new reviewed classification |
| POST /api/payroll-runs/[id]/exports | Export/preflight action set is not proven to have the required owned successful outcomes with all money flags OFF. | HOLD; no partial action extrapolation |
| POST /api/payroll-runs/[id]/xendit-payout | Disabled-provider 501/409/403 checks are negative controls, not an owned successful payout. | HOLD; no provider enablement or financial proof credit |
| GET /api/setup | Global, anonymous first-run boolean response without tenant-private resources. | **Public candidate**, not COVERED; approval required |
| POST /api/setup | Privileged one-time bootstrap creates employer/user/session; requires real disposable transaction/race/rollback proof and scoped setup-token review. | HOLD; do not borrow GET's rationale |
| POST /api/signup/resend | Anonymous verification resends require generic-response enumeration safety, no cross-account email misuse, authorized queued-mail proof, and unchanged other-account SQL. | HOLD |
| POST /api/signup | Public new-workspace creation; current rate-limit hardening is not whole-method transactional own/foreign proof. | HOLD |
| POST /api/signup/verify | One-time token activates a user/subscription/session and writes audit state; requires full successful token lifecycle, replay/foreign-account denial and unchanged-victim checks. | HOLD |

## Required next actions, in review order

1. **Owner policy decisions (classification, not proof):** decide whether public
   unauthenticated `GET setup` and `POST intake-challenge` are intended; authorize
   scheduler as an independently reviewed global token-only operation or retain
   its GAP. The SAML metadata disabled-provider disclosure is a separate identity
   decision and cannot be bundled into generic public acceptance.
2. **Review and exact-head proofs:** after any accepted policy decision, add an
   explicitly scoped manifest update, new public/operational method guard tests
   and the correct inventory/closure-plan reconciliations. Run final-head CI,
   source-identity checks and applicable disposable PostgreSQL 16 HTTP tests.
3. **Identity batch:** prove SSO start/callback/resolve and signup/setup account
   lifecycle in isolated fictional PostgreSQL with local-only simulated IdP
   and email transports; test real persisted victim isolation and replay. Do not
   enable SAML, paid registration or provider connections to obtain a green run.
4. **Remaining business methods:** separately cover *all* automation-studio POST
   actions, scrutinize marketing aggregate privacy, and design flag-OFF-compatible
   owned outcomes for exports/payouts where feasible; otherwise document the
   missing legitimate successful path. Never activate Xendit or real money merely
   to close a test gap.

This PR adds only source-pinned **review guards and the decision record**.
It does **not** modify production routes, feature flags, tenant methods, the
coverage manifest, shared frozen queue, PostgreSQL schema, CI workflows, or
acceptance ledger. A source change or premature status promotion makes its
negative-control tests fail. Merging this note would not close even one method
without the separate classification or method-specific proof PR.

**Safety:** no production databases, no live PostgreSQL/Neon, no external
identity provider, no live mailboxes, no payroll or payout operations, no
live scheduler, no tenant credentials, no migrations, no customer data and
no production deployment. Independent security/privacy/identity/operations
acceptance remains PENDING.

# SSO-01 — Verified domain / provider employer boundary

**Status:** Draft review candidate, 2026-11-10. **API method remains GAP, zero coverage credits.**

## Why this is a separate tenant family

The anonymous `POST /api/auth/sso/resolve` endpoint discovers an identity provider from an email domain. The previous SQL lookup joined `identity_domains.provider_id` to `identity_providers.id` and checked the verified domain and provider enabled flag. It did **not** explicitly require `identity_domains.organization_id = identity_providers.organization_id`. Both columns are individually foreign-keyed, but that does not by itself guarantee the same employer for the pair.

A mismatched verified-domain/provider association could disclose another organization's identity-provider name and ID during discovery, or direct a user toward the wrong provider. This is a source-identified missing employer SQL bound; it is **not** a claim that a real production tenant leak was exploited or confirmed.

## Narrow application change

- Join verified `identity_domains` to **the same employer's** provider on both provider ID **and organization ID**; allow enabled **OIDC** providers only. Existing OIDC start already checks the provider's verified own-employer email domain.
- Accept only a canonical string email and valid dotted DNS domain; reject type coercion, duplicate `@`, wildcard, malformed domains, and untrusted organization/provider/body IDs as selectors. No default employer.
- Require the shared PostgreSQL distributed rate limiter; refuse with HTTP 503 rather than performing anonymous SSO discovery on an instance-local fallback when the authoritative limiter is unavailable.
- Explicit `Cache-Control: no-store` for discovery results.
- No changes to login callback, credential verification, SAML runtime, SCIM, role grants, financial/payroll actions or outbound provider requests.

## Disposable PG16 / production-mode HTTP candidate

The dedicated workflow `.github/workflows/tenant-sso-discovery-http.yml` runs an empty fictional PostgreSQL 16 database and a localhost-only **production-mode Next.js server** with workers, money and external provider credentials disabled. Its source-pinned runner `scripts/qa/tenant-sso-discovery-http.mjs` requires an exact allowlisted CI environment **before any application or database import**.

It seeds two independent employers and a persisted higher-ID victim, each with an enabled OIDC provider and a verified domain. It verifies a nonempty successful discovery for each own domain, ignores forged employer/provider IDs, rejects unavailable/unverified/SAML providers, and checks SQL snapshots remain unchanged.

The **cross-employer negative** uses disposable SQL to deliberately point Employer A's verified domain row at the higher-ID victim's provider while keeping Employer A's organization ID. The endpoint must return only `{ "available": false }` and must not expose the victim provider's name, provider ID, or mutate any organization's provider, domain, employee, payroll, audit, session or login-state rows.

The query is intentionally anonymous. This scenario verifies an **employer-consistency join**, not authenticated cross-employer authorization of a tenant-private method. There is no valid reason to label all of this POST method `COVERED` or `PUBLIC-BY-DESIGN` without a separately approved classification and exact-head real-HTTP review.

## Merge hold

- [ ] Focused parser/proof contracts and full required CI pass on the exact final PR SHA.
- [ ] Dedicated three-employer real HTTP PG16 workflow passes on the exact PR head, including owned positives, deliberate foreign provider cross-link denial, forged selectors, and unchanged DB snapshots.
- [ ] Identity owner confirms that anonymous discovery of one **verified** work domain's provider name/ID is an intended public policy. This PR does not change that product policy.
- [ ] Independent security/identity privacy review; no owner-only self-approval counted.
- [ ] No coverage promotion, deployment, production config or billing changes before acceptance.

**No customer, HR, production, provider, payroll or payment data accessed or modified by this draft.**

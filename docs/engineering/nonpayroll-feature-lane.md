# Non-payroll feature lane — isolated public product improvements

Scope: public informational pages and browser-only tools. This is not a payroll, HRIS authorization, payment, tenant-coverage or production-release lane. Each feature lives in its own draft PR and is reviewed independently.

## Guardrails

- Do not edit `src/db/**`, `drizzle/**`, `src/app/api/**`, payroll calculation/release/payout modules, tenant-isolation manifests, session/access control, environment and deploy configuration, or shared migration code.
- No production SQL, real employee fixtures, provider traffic, feature flag changes or payroll processing. No synthetic evidence may be represented as a real-world certification.
- Build on `main`, use unique file paths, and reconcile every PR with an updated `main` before review.
- New interactive tools are client-only, opt-in and sample-data first. Do not add telemetry, file uploads or durable storage of personal records.
- Mark new public routes `noindex` until a separate SEO review explicitly assigns search intent, sitemap ownership and content/legal approval.
- Before merge, require the changed-unit tests plus full `npm run lint`, `npm run typecheck`, `npm run build`, `npm run seo:audit`, applicable security/tenant tests and a reviewer pass. CI on the exact PR head is authoritative; local standalone unit tests alone are not release evidence.
- Explicitly verify that the PR changed-file list contains no sensitive path and that existing payroll parallel-reconciliation tooling and tests are untouched.

## Planned independent PRs

1. Browser-only employee CSV preflight (this PR): structural checks, fictional sample, sanitized issue report. Final authorized import still runs its own server checks.
2. Fictional guided product tour: static read-only examples; do not modify `/demo` authentication, sandbox roles or redirects.
3. HR template/help refinement: public blank checklists and content instructions; no employee data, records or approvals.

All three are safe-to-review candidates, not claims that production financial controls are complete.

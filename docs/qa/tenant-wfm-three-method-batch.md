# WFM three-method tenant-isolation QA batch

**Status: DRAFT, ZERO NEW METHOD CREDITS, NOT ACCEPTED.**

## Exact owned API methods
- GET \`/api/workforce/demand-staffing/policies\`: reuse the existing approved-policy genuine two-attacker/real higher-ID victim HTTP/PG16 receipt at \`scripts/qa/tenant-demand-approved-policy-get-http.mjs\`. The dedicated job must use the separately bootstrapped \`allowlisted-reads\` profile. A 200 empty list or an unapproved policy is not proof.
- GET \`/api/workforce/greedy-roster\`: reuse the existing source-bound nonempty owned 200, foreign/forged 403/404, role and revoke proof at \`scripts/qa/tenant-wrk01-greedy-roster-http.mjs\`. This runner requires an *empty* disposable database before its fictional seed.
- POST \`/api/workforce/roster-rules/preview\`: new \`scripts/qa/tenant-wfm-three-method-post-http.mjs\` follows that greedy GET in the same fictional PG16 job. It checks two separate owner-employer sessions, a real higher-ID victim with its own positive response, distinct SQL policy projection, both \`rest_day\` and \`shift\` positive paths, foreign employer/worker/worksite/shift denials, unknown-versus-foreign indistinguishable responses, anonymous/employee/revoked membership, and persisted audit/roster/payroll invariance after every probe.

The two jobs **must not share feature-flag profiles**. No application routes, shared tenant manifest, DB schema, migrations, release flags or financial calculations are changed in this PR. Source status for all three methods remains GAP until verified exact-head CI, method-specific evidence linking and independent tenant/security review. Existing independent GET receipts are intentionally *reexecuted* at the branch's exact head, not claimed to be new work.

## Release boundaries and safe execution
Only pull-request jobs on an in-repository branch. PostgreSQL 16 uses a disposable service at \`127.0.0.1:5432/app_db\`; app server is \`127.0.0.1:3000\`. All employers, personnel and sessions are synthetic. The tests block a hosted DB, production URL and payment/provider secrets. The privileged app is not exposed publicly. No production Neon/Vercel, actual PII, filing, money movement, payroll release, provider calls, roster publication or activation. No auto-merge.

## Independent acceptance checklist
- [ ] CI for both jobs green at **exact current PR head SHA**, with no skipped profiles or false owned 200.
- [ ] Inspect all three methods' actual source and response-level organization, employee, worksite, shift and role scoping.
- [ ] Confirm two independent actor logins, genuine victim higher IDs, SQL-bound own rows and unchanged victim/other-employer persisted records.
- [ ] Review unknown-versus-foreign denial parity and the absence of SQL diagnostics or other tenant markers.
- [ ] Reconcile any concurrently changed global manifest/inventory with current main; do **not** overwrite another PR's credits.
- [ ] Security and WFM/domain owners independently approve the specific proof and code before any future standalone credit PR.
- [ ] Physical-device/operator WFM acceptance #691 remains **NOT_RUN** unless independently witnessed.

Source integration, tenant-method credit, independent operator acceptance, payroll certification and deployment are separate decisions.

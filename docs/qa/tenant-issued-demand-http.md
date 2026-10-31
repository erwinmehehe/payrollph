# Issued-demand POST and final-score tenant isolation candidate

**Status: DRAFT / ZERO METHOD CREDITS.** Disposable PostgreSQL 16 and
production-mode localhost Next.js HTTP acceptance for exactly two methods:

- POST workforce/demand-observations/issued
- POST workforce/demand-observations/issued/score

GET workforce/demand-observations/issued already has a separately reviewed
read proof. It is not re-credited. Loyverse and Square Sandbox GET/POST routes
are **excluded**: their source adapters require consent and POS credentials,
and disabled-pilot denials cannot count as genuine authorized positive proof.

## Environment and independent targets

The dedicated .github/workflows/tenant-issued-demand-http.yml uses the
existing allowlisted-reads tenant-table profile and pre-server bootstrap.
A new empty local PostgreSQL 16 database receives two separately signed-in
People-admin attackers, a genuine persisted higher-ID victim employer, and
a fourth non-allowlisted employer. The three authorized employers' actual SQL
IDs are exported to both WFM operational-demand and issued-demand allowlists
before Next builds; there are no wildcard, hardcoded production or
provider-specific allowlists.

The runner refuses any target except GitHub Actions, the exact localhost
app_db URL, local Next at port 3000, the CI-only private cookie fixture,
a privileged-MFA-enabled production-mode server, and matching three-employer
allowlists. Payroll/payout/provider flags, workers, external scheduling,
Loyverse POS and Square Sandbox are OFF. Provider access tokens and secrets
must be absent. Per-employer source/payroll and audit SQL snapshots are kept.

No production, staging/Neon database, provider account, POS merchant,
roster, shift/punch, payroll, payment, filing or employee data is used or
modified. The workflow never deploys.

## Positive real HTTP cases

For both attackers **and separately for the victim**, the harness:

1. Persists employer-unique Philippine-worksite SQL rows and 12 weekly,
   complete, fictional historical aggregate observations with real version
   IDs and historical recorded timestamps.
2. Calls the actual POST issued handler with the real actor's authenticated
   cookie and employer-scoped source. HTTP 201 must insert one real SQL
   issue and one corresponding actor/employer/source/hash-bound audit.
   The frozen snapshot must be future-only, SHA-valid and nonempty.
3. Creates a **synthetic 25-day-old issued snapshot** using the existing
   production forecast/SHA helpers, with source revisions timestamped
   before that fictional issue. Corresponding later complete observations
   are also fictional SQL fixtures. This is **not** historical HTTP issuance.
4. Calls the actual POST issued/score handler. HTTP 201 must add exactly one
   frozen SQL score and one audit entry bound to actor, source issue,
   settled revision IDs, and report digest; no roster/payroll data changes.
5. Requires HTTP 200 idempotency replay to leave all SQL and audit unchanged.
   A later fictional source revision cannot rewrite the score or add an audit.

A passing POST cannot be replaced with a forged response, another employer's
source, a no-op, a disabled-pilot reply, or an idempotency replay. The
dedicated contract suite includes deliberate negative controls.

## Denials and immutability

For each attacker: genuine allowlisted higher-ID victim employer 403;
owned employer with victim worksite 403; victim issue ID 403; forged source
key or changed idempotency horizon 409; premature score 409; person-level
unexpected input 400; anonymous 401; and session without current MFA 403.
The non-allowlisted employer's 404 is explicitly a **pilot-disabled** result,
not tenant-authorization evidence.

Every denial compares all four employers' persisted worksite, aggregate
source, import, issue, score, worker, pay profile, schedule assignment,
punch, payroll, membership and business audit snapshots. Each genuine
positive requires other employers to remain unchanged.

## Acceptance limitations

The synthetic historical issue is **not proof that CI truly waited 25 days**
between issuance and scoring, nor that external POS counts were independently
authenticated. It validates the live route and source/SQL binding on
deliberately constructed historical test data. Independently elapsed source
chronology or provider-verified facts need more evidence.

Run source/guard tests first:

    node --check scripts/qa/tenant-issued-demand-contract.mjs
    node --check scripts/qa/tenant-issued-demand-http.mjs
    node --test tests/tenant-issued-demand-contract.test.mjs

Only the dedicated CI workflow runs the real SQL/HTTP harness. A successful
exact-head job, reviewed executed HTTP/SQL receipts, source pins, independent
security/owner acceptance and a separate reviewed manifest edit are required
before either method can move from GAP to COVERED. A merged draft or a
passing source test does not grant any method credit.

Introduced files: fail-closed contract, real HTTP runner, pure regression test,
this document, and the dedicated workflow. No production route, schema,
feature-flag default, tenant guard, paid integration or inventory is changed.
Rollback simply removes these additive files.

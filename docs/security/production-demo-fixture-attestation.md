# Production public-demo fixture attestation (merge safety boundary)

**Default is deny.** Public demo sessions MUST NOT be provisioned on a customer-serving database, even if the employer has the display name and legal name of the demo company. This gate is separate from payroll release and is NOT evidence of independent production RBAC/UAT.

## Preconditions for ever enabling a production demo

A DBA/deployment owner must independently provision and inspect a **dedicated fictional-only Neon PROJECT** (not a branch, replica or copy of the customer production project). The project must use a distinct database, Neon branch, endpoint, TLS-verified hostname and app role. Never reuse customer application database credentials or host. Obtain branch/project/endpoint identifiers from the Neon control plane and verify them against a connection to the dedicated fixture database.

Before creating the deployment configuration, a separate authorized operator must confirm that the database contains **one previously registered fictional organization** only, including that its integer primary key belongs to the approved fixture. Review any employees, payroll runs, membership users and sensitive fields to ensure there are no customer records. A name or legal name match alone is never acceptable evidence. Creation of a production fixture organization by an anonymous login is prohibited.

Set the following **server-side deployment variables** only on the dedicated demo deployment after that attestation:

- `PUBLIC_DEMO_DATABASE_ATTESTED=true`
- `PUBLIC_DEMO_NEON_PROJECT_ID` — dedicated project (must differ from the customer production project)
- `PUBLIC_DEMO_NEON_BRANCH_ID` — dedicated branch (must differ from customer production)
- `PUBLIC_DEMO_NEON_ENDPOINT_ID` — dedicated PostgreSQL endpoint
- `PUBLIC_DEMO_DATABASE_NAME` — existing fictional-only database
- `PUBLIC_DEMO_DATABASE_ROLE` — independent fixture-only database role
- `PUBLIC_DEMO_DATABASE_HOST` — exact TLS-verified Neon hostname (must match `DATABASE_URL`)
- `PUBLIC_DEMO_ORGANIZATION_ID` — registered integer ID of the **existing** fictional organization

Never put passwords, URLs containing credentials, readiness tokens or fixture secrets in a pull request or CI log. No real customer's database should have the demo attestation flag enabled.

## Enforcement

On production, the private readiness probe and the public demo-switch POST both require a positive match between the **actual PostgreSQL session metadata** and the pinned project, branch, endpoint, database, role, connection host and pre-registered fictional organization ID. The known customer production project is explicitly forbidden. The organization inventory must contain exactly one matching attested fixture; duplicate or same-name customer organizations deny. Unknown/missing settings return blocked; database errors return unverified. Neither state can authorize demo identities.

The provisioning function checks the identity **again within its locked write transaction** before inserting or updating employees/payroll. The POST uses the attested organization ID rather than selecting a row by name; it checks again before creating user sessions. A customer's matching names cannot be used as an authorization credential.

The default deployment without operator attestation intentionally responds with HTTP 404 to demo login, not a successful fictional session. The protected diagnostic may report `blocked_non_demo_employer`. This is **not a six-role production pass**. The isolated six-role CI suite uses only localhost and disposable PostgreSQL 16.

## Verification and rollback

Run the source unit tests and the disposable PG16 adversarial no-write/no-cookie scenario, followed by all exact-head CI and security checks. On a separate authorized fixture deployment, test real operator-attested database identity, unique organization ID, and guarded demo responses before any live role UAT. Keep production payroll, bank, payout, statutory filing and customer-data operations outside this fixture acceptance.

**Emergency disable:** Remove or set `PUBLIC_DEMO_DATABASE_ATTESTED=false` on the demo deployment, then revalidate that demo-switch denies without a session. Never bypass the guard with an employer name override. Do not mark the PR or deployment production-payroll certified from these tests.

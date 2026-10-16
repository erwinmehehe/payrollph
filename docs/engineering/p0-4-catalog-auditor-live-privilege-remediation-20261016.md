# P0-4: Live catalog auditor privilege incident and safe repair plan

**2026-10-16 — source-only security response; production NO-GO.**
Evidence was collected through read-only PostgreSQL system catalogs in Neon project
`calm-wave-70219564`, default branch `br-lucky-sound-b79i56jw`,
database `neondb`, expected endpoint `ep-cool-hat-b7e7gpoo`, PostgreSQL 18.6.
The *effective* Vercel/worker production secret-to-endpoint mapping has NOT been
verified. No production DDL, DML, role change, restore, payout or application-row
SELECT occurred in the audit.

## Confirmed privilege failure: do not use the current auditor credential

`payrollph_schema_auditor` was a LOGIN role with:
- `rolcreatedb=true`, `rolcreaterole=true`, `rolreplication=true`,
  `rolbypassrls=true`, `rolinherit=true` (not a superuser attribute itself).
- Direct membership in `neon_superuser` with `inherit_option=true` and
  `set_option=true`, grantor `cloud_admin`.
- Effective `CREATE` on database `neondb`; employee and payroll
  application-table SELECT/INSERT/UPDATE capabilities. Tested only
  `has_*_privilege()` predicates; **no application records were read**.
- Public application tables, including `employees` and `payroll_entries`,
  were owned by `neondb_owner` with no relevant explicit `relacl`. These
  unexpected rights come from effective role privilege/membership, **not an
  explicit grant on each table**. Revoking individual table grants alone
  cannot remediate this role.
- The separately named `payrollph_catalog_audit_1031` is `NOLOGIN`,
  `NOINHERIT` and non-elevated; it is **not** evidence that the LOGIN
  `payrollph_schema_auditor` is safe.
- The proposed catalog-only role `payrollph_migration_catalog_auditor` from
  `docs/engineering/p0-4-catalog-auditor-bootstrap-template.sql` is not
  currently an authenticated approved production login. The bootstrap
  intentionally requires three genuine DBA-adopted control tables first.

**Do not send this credential to any full-schema, receipt or historical audit.**
Do not allow privileged writer credentials to be recycled under an
`auditor` name. A repeatable-read READ ONLY transaction prevents writes
*during that transaction*; it does not remove privileged data access or
make the credential an acceptable auditor.

## Safe, ordered security change — requires an authorized operator

1. **Freeze and inventory dependencies.** DBA/security operators verify
   which deployment or scripts use `payrollph_schema_auditor`, assess
   production service disruption, independently prove actual Vercel/worker
   host/branch/role routing, retain a private ticket and issue #899 impact
   disposition. No connection passwords or row-level contents in GitHub.
2. **Prefer a distinct least-privileged login**, created under an approved
   direct PostgreSQL operator change following the repo's NOLOGIN bootstrap
   design, with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
   NOBYPASSRLS NOINHERIT`, **no** `neon_superuser` or any other role
   membership, `CONNECT` on the reviewed database, and schema usage only.
   If approved historical receipt/cutover/journal tables actually exist,
   grant SELECT only on those three control tables. They are **currently
   absent**; no role bootstrap or fake receipts may be run to bypass this.
   Catalog-only schema checks can have a separately approved limited login
   before adoption; receipt verification cannot claim success without the
   authentic journals.
3. **For the old login, only after dependency mapping:** either explicitly
   revoke its `neon_superuser` membership and elevated role attributes
   under a controlled owner-authorized security transaction **or**
   decommission it after a tested credential cutover. Do not revoke or alter
   the global `neon_superuser` role itself; do not revoke broad PUBLIC
   grants or change application owner access. Managed Neon role creation may
   create unexpectedly elevated logins: independently test **actual effective
   flags, membership and privileges after reconnect**, not just a role name.
4. **Independent post-change negative controls:** require no elevated flags,
   no memberships, no DB/schema CREATE, no application or `neon_auth`
   relation read/write (including column grants and sequences), no executable
   SECURITY DEFINER routines outside system schemas, and no app payroll data
   access. Require pinned project/branch/endpoint/database and verified TLS.
   An operator must also test loss of rights across reconnects, implicit
   PUBLIC permissions, inherited roles, default grants and alternate schemas.
   A guard failure is STOP, never an exception to ignore.
5. **Only after the verified credential exists**, securely provision the
   protected production GitHub audit secret. Run the manual, exact-main
   #1031 full schema diff and historical ledger/receipt audit separately,
   with no production writer secret. Do not dispatch PLAN/APPLY, change flags,
   or run payroll/bank operations on the basis of an auditor fix.

This change adds `scripts/lib/production-catalog-auditor-gate.mjs` and a
manual protected `scripts/verify-production-catalog-auditor.mjs --verify`
preflight to the #1031 and production inventory workflows; receipt audit
also invokes the stricter gate **before any journal SELECT**. The gate uses
only `pg_catalog` and returns booleans; it does not read application rows.
The check is expected to **reject the observed live role**, and it is not
a script that changes privileges.

## Migration-history findings retained, not inferred away

On the same Neon default branch, read-only catalog inspection found:

| Evidence predicate | Result |
| --- | --- |
| Recovery targets from #1015/#1054/#1061 | **10 / 10 absent** |
| Sampled 0115–0123 payout/provider/WFM/entity predecessor tables | **15 / 15 absent** |
| Sampled parent relations with exact single-integer-id PKs | **12 / 12 present** |
| `staffing_requirement_role_unique` | Valid, ready, unique, full five-key btree (unpredicated) |
| Expected source `0127_year_end_prior_evidence.sql` table | **Absent** |
| Public permanent base tables (at observation) | 136 |
| Named migration control journal / adoption / receipt relations | **None found** via catalog-name inventory |
| Exact historical full-path and SHA-256 applied/baseline receipts | **Not established** |
| Current synthetic PR #1121 PG16/PG18 ten-table check after 0128 | **263 PASS, 0 MISSING / DRIFT / EXTRA** (CI only) |

The existence of `drizzle/0127_year_end_prior_evidence.sql` (source SHA-256
`099636d41584debcafad8c4c955eaf1cc5972f50386a7a249624b3a44c0546d3`
in the source worksheet) does not prove that it executed, nor does an
absent target prove exactly which migration did not execute. The worksheet's
receipt columns are unfilled; source hashes are **not migration receipts**.
Legacy duplicate-prefix groups need individual full-path/hash evidence.

**STOP before 0128 in production.** Independently reconcile historical
0115–0127 application/adoption and the earlier 13 duplicate-prefix groups;
obtain genuine reviewed receipts and separately authorize a protected
migration PLAN. The actual 0121 source includes a historical employee/payroll
attribution backfill requiring separate real employer evidence. No
automatic history rewrites, no fake baseline receipts, no ad hoc SQL.

## Explicitly NOT completed by this source update

- No live role was modified, demoted, revoked, rotated, disabled or created.
- No actual `production` GitHub environment was connected/configured.
- No authenticated live HR/payroll/persona smoke, Vercel credential mapping,
  backup/restore witness, history receipt review or production 0128.
- #899, #907, #908, #1015, #1054 and #1061 remain independent production
  authorization and recovery gates. Do not convert a green CI test into
  a production approval.

## Source guard hardening and synthetic acceptance

The shared gate now runs inside the same READ ONLY connection/transaction used by both catalog readers and the receipt reader. The standalone workflow preflight is supplemental. All three readers reject an unpinned database/host, pooled endpoint, startup options or unverified TLS before connecting.

The login must also equal the session identity and own no objects. Ownership can restore privileges even after ordinary grants are revoked. Column-level INSERT/UPDATE/REFERENCES and PostgreSQL 17+ MAINTAIN are rejected alongside table ACLs, sequence access, memberships and SECURITY DEFINER execution. PostgreSQL explains these distinctions in [privilege inquiry functions](https://www.postgresql.org/docs/current/functions-info.html) and [object ownership](https://www.postgresql.org/docs/current/ddl-priv.html).

`node --test scripts/qa/catalog-auditor-postgres.test.mjs` executes the actual guard SQL with a fresh restricted LOGIN on disposable PG16 and PG18. It exercises individual column/table grants, PUBLIC access, alternate auth-shaped schemas, ownership after ordinary privilege revocation, role elevation, SET ROLE disguise, wrong identity, journal permissions and transaction mode. Fixture Neon settings are synthetic inputs on vanilla PostgreSQL; they do not attest the real endpoint or its actual roles. This acceptance workflow has no production secrets or dispatch path and refuses a database with preexisting application objects or fixture roles.

No application runtime/UI or release-flag default changes. Protected production inspections remain manual-only. No role remediation, live audit dispatch or production migration is authorized by this source change.

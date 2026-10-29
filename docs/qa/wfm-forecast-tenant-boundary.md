# Workforce forecast employer-bound reads (#1599)

The historical WFM forecast previously joined a recurring compensation
assignment to its component definition by the global component ID alone.
The ID-only FK does not prove that both records are owned by the same
employer. This patch adds both organization equality and requested-employer
equality inside that SQL join. Existing date, active-state and amount
calculation behavior remains unchanged for valid same-employer rows.

A shared pure scope checker now accepts only a positive safe employer ID
matching the requested employer, with either company-wide access and no unit,
or unit-scoped access with a positive safe unit. Both the WFM forecast server
and historical demand-outlook helper use it. The forecast validates the access
before its bulk financial SQL reads. Other API session/role checks still apply.

Unit tests exercise valid and invalid identities, inconsistent scopes,
foreign worksite IDs, inactive worksites, and malformed values. A source
regression pins both sides of the SQL join, the active component filter, and
the access check position. Deliberate removal of each join predicate fails
the source regression.

Release boundary: source-only mitigation, not a confirmed incident,
not a successful authenticated PG16 HTTP tenant proof, and not new tenant
coverage ledger credit. This PR changes no API route, schema, migration,
production settings, flag, payroll computation, release gate, provider or
real employer data.

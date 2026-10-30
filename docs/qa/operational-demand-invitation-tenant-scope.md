# Source-only tenant access coherence hardening

Scope: operational-demand workforce outlook and invitation authorization helpers.

## Review findings
- The operational-demand site helper previously evaluated `access.companyWide || ...` before confirming that the grant's company-wide flag and unit assignment were coherent. A malformed grant such as `companyWide: true, orgUnitId: 3` could be treated as globally authorized within the already selected employer. It now requires an exact positive employer ID, active and valid same-employer site, and an explicit Boolean company/unit scope. The SQL route's existing employer and site predicates remain unchanged.
- The invitation helper previously used a truthy company-wide condition and parsed string values in persisted membership units. A malformed runtime grant such as `companyWide: "true", orgUnitId: null` could be interpreted as company-wide, or a string unit as an assigned manager unit. Both now fail closed. Canonical string parsing for **submitted invitation input** remains supported.

## Regression and release limits
- Existing same-employer company-wide and valid assigned-unit paths still return the original values.
- Negative tests cover cross-employer IDs, other units, inactive/malformed sites, ambiguous Boolean flags, and invalid numeric/string membership units.
- No API route, tenant-coverage manifest, database schema/migration, feature flag, payroll/payout logic, real employer data or production setting was changed.
- **No new COVERED method credit**, no signed-in real-HTTP tenant proof, and no claim of a confirmed production exploit. Exact-head CI/security checks and independent owner/security review are required before merge. Production release remains NO-GO.

# Confirmed audit fixes — October 11, 2026

This integration combines draft branches #743 (centavo payroll rounding and prior-ledger guard), #757 (final-pay mandatory shortfall accounting), and #749 (authorized leave-conversion caps/reservations). Their component tests and release controls are retained. Integration is source preparation, not live payroll or provider activation.

Additional fixes:

- Basic and unworked-holiday payslip lines reuse their separately rounded components, including half-cent holiday values, rather than subtracting raw fractions from rounded gross.
- Migration calendar dates use explicit UTC parts with Gregorian validation. Numeric MM/DD and DD/MM inputs are supported when unambiguous; ambiguous inputs must be converted to YYYY-MM-DD. Named month dates are supported. No host-timezone parsing or timestamp-to-date conversion.
- ESLint is pinned to the compatible 9.39.5 release and lint is mandatory in CI. `eslint-suppressions.json` records 142 pre-existing errors as a counted, per-file/per-rule baseline. It is visible cleanup debt, not a claim of zero lint violations. New errors fail lint; CI must never regenerate the baseline. Generated QA artifacts are ignored.
- CI runs tests and golden suites with TZ=Asia/Manila.
- Separation leave monetization identifies one leave type, requires a matching active policy, approved employer conversion cap, and authoritative annual balance; pending leave and existing cash conversions reduce entitlement. Source evidence includes balances, policies, caps, and conversions. The serializable final-pay transaction rechecks this evidence, and release consumes the monetized days atomically with settlement. Legacy packages require recomputation. Ordinary conversion and separation use the same approved cap configuration (`LEAVE_CONVERSION_MAX_DAYS_JSON`); do not configure an arbitrary cap without employer policy approval.
- The schema README describes the historical baseline accurately and removes stale table counts.

Region VII effective-date handling and trusted proxy-hop IP handling were already present on main and are retained.

The webhook fix stays in separate PR #745 to preserve the repository payout/payroll isolation rule. Its provider inbox SQL 0110 requires a separately controlled schema release before provider activation. No production SQL, bank backfill, employer data access, transfers, or payroll release was performed. CI uses synthetic bank data. Production pilot account contents remain unverified; deployed encryption and completion of the historical bank-data backfill are still required for real bank accounts.

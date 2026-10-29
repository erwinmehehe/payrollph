# #1015: guard empty-roster attendance schema readiness

## Observed code gap

The already-repaired attendance_exception_events relation was never resolved by
GET /api/workforce/attendance-exception-events when a permitted organization's
visible employee roster was empty. That request could report HTTP 200 with
zero exceptions even with a missing database relation. A tenant with visible
employees would instead fail, exposing inconsistent readiness behavior.

## Fix

After session, role and tenant scoping, an empty roster now executes a read-only
SELECT of all mapped event columns with LIMIT 0 and the authenticated
organizationId. PostgreSQL must resolve the relation and columns, but no
attendance or payroll rows are read. A missing relation fails the request and
the existing client shows Exception ownership unavailable rather than zeros.
Date windows must be Gregorian-real and no longer than 42 inclusive days.
Both GET success responses are private and no-store. POST is unchanged.

## Limits

This does not certify a migrated production schema, the historical receipts,
deployed runtime database identity or authenticated hosted user acceptance.
Related PR #1568 adds separate fictional PostgreSQL 16 real-session GET
coverage. Keep #1015 OPEN until DBA/release/operator acceptance is recorded.
No database schema, migration, secrets, flags, payroll or payout changes.

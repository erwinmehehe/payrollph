# Public API v1 read extensions

Scope: Existing `/api/v1/employees` (GET/POST) and `/api/v1/payroll-runs` stay unchanged, including key issuance/revocation, rates and write idempotency. The extension flag `API_V1_EXTENDED_READS_ENABLED` gates:
- GET /api/v1/org-units (employees:read)
- GET /api/v1/payslips (payroll:read, RELEASED records only, not downloadable payslip PDFs)
- GET /api/v1/events (payroll:read; signed outbound webhook **delivery metadata**, no secret/payload)
- GET /api/v1/provider-events (payroll:read; durable `provider_events` inbound inbox metadata, migration 0110)
- GET /api/v1/journal-entries (payroll:read; audited balanced debit/credit draft CSV based on immutable run totals).

API description in `docs/openapi-payrollph-v1.yaml`. No external accounting connection or automatic ledger posts. Reconcile chart-of-accounts mappings with accounting reviewers before activation. Data-scope review must check tenant and **legal employer** scope, pending multi-entity RFC approval. The API key grants tenant read; group-level legal-employer grants are not implemented.

**Legal-employer boundary:** The extended v1 authorization permits exactly one active legal employer for the tenant. Zero matches are ambiguous legacy attribution and multiple matches require employer-scoped API token grants under RFC B-8. Both fail closed; tenant-scoped keys are never treated as cross-entity group-HR permission. Invalid journal date filters return a client error rather than an unhandled server exception.

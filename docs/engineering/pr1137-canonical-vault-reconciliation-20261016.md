# PR #1137 — canonical Worker 360 / ESS vault reconciliation

**Reviewed:** 2026-10-16. **Scope:** source-only, test-only integration. **Do not activate the production employee-document vault.**

## Why PR #1137 was reconciled instead of blindly merged

PR #1137 was developed against `main@6a2c31fc08601f7f48b4ecda795bbdc3e5c64dc2`. Subsequent work on `main` already delivered the same user-facing employee vault through a single canonical path:

- `src/app/hcm/worker-360/page.tsx` and `src/components/hcm-worker-360.tsx` expose the private document panel to authorized HR/owner users behind `employeeDocumentVault`.
- `src/components/employee-documents-panel.tsx` embeds the same `EmployeeVaultProfilePanel` in ESS for authorized employees.
- `src/components/employee-vault-profile-panel.tsx` and `src/app/api/employee-vault/route.ts` implement employee-specific metadata, uploads, display, and controls.
- `src/app/api/employee-vault/[id]/route.ts` and `src/lib/employee-vault-document-removal.ts` enforce tenant membership, People permissions, same-origin, MFA, rate limits, and audit-retained soft removal.
- `src/app/api/documents/route.ts`, `src/app/api/documents/[id]/route.ts` and `src/lib/document-object-storage.ts` remain the canonical, signed private-byte upload/download paths and preserve the `vault-removed:` marker.
- `.github/workflows/employee-vault-profile-browser-acceptance.yml` and `scripts/employee-vault-profile-synthetic-browser.mjs` already exercise authenticated disposable PostgreSQL/MinIO desktop and 390px employee journeys and artifact captures.

The older PR's independent `WorkerDocumentVault` panel, separate GET/list and DELETE logic, metadata soft-delete convention, scanner fixture and second browser workflow overlap this subsequently merged implementation. Combining these blindly could introduce **two different removal markers**, duplicate panels, or regressions in employee permissions.

**Resolution:** Integrate the newer `main` canonical implementation into PR #1137. Do **not** replace newer A-5 application code with the older duplicate. Keep the additional meaningful regression proof from this PR: the authenticated browser now asserts horizontal overflow **while a document is visible** at both 1440px and 390px, not merely after document deletion, and reports `noOverflowWithDocument` separately.

## Validation and rollout requirements

1. Execute the existing canonical Employee Vault Profile Browser Acceptance on the **exact reconciled commit**. Check real screenshots and synthetic JSON; no screenshot/CI pass may be inferred from old PR head.
2. Run all triggered GitHub checks against the reconciled merge commit; confirm main CI including regression shards, TypeScript and build succeeds.
3. Keep `EMPLOYEE_DOCUMENT_VAULT_ENABLED` and `DOCUMENT_UPLOADS_ENABLED` **OFF** in production. This integration adds no runtime configuration, migration, schema mutation, object provider, employee data, payroll payout, statutory filing or production key changes.
4. Distinguish **source-code merge** (after checks and required reviews) from **A-5 operational release**. Real private storage, malware scanning, key custody, legal retention, DPA, restore evidence and independent HR/security acceptance remain separate explicit pre-activation gates.

**This is a reconciliation and acceptance-test improvement, not a new employee-vault implementation or authority to process real files.**

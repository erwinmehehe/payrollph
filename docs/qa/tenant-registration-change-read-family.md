# Multi-entity statutory registration request: tenant-isolation read candidate

**Target:** `GET /api/multi-entity/registration-changes?organizationId=...&legalEntityId=...`, specifically the **pending request metadata** path. The authoritative coverage manifest currently marks `GET multi-entity/registration-changes` **GAP**. This work grants **zero coverage credits**.

## Independent family

At selection, no open PR targeted multi-entity registration changes. The proposal adds a standalone `read/registration-changes.mjs` proof, its focused Node test, this note and one disposable-profile flag in `scripts/qa/tenant-table-env.mjs`. It does not modify a shared application route, schema, migration, money pipeline, payroll release, production environment or coverage manifest.

## Genuine disposable evidence required

Existing shared tenant table runner (profile `multi-entity`) creates two independently authenticated fictional employer owners and a third **real higher-ID victim** in disposable PostgreSQL 16. For each employer, the new row first grants the owner its own legal entity and inserts one genuine persisted `pending_approval` statutory registration-change request.

Each seeded row has:
- **The employer's actual organization ID, legal entity ID and requester user ID**, a real returned request ID, and an employer-unique reason marker.
- A deliberately nondecryptable, synthetic *envelope sentinel*. The route should not decrypt or return it: this is a **field-exclusion test, not cryptographic proof**.
- A `displayName` change-field name, no approved version, and no payment, government ID, bank change, approval, filing or money movement.

| HTTP scenario | Required |
| --- | --- |
| Signed-in owner reads its own `organizationId` and actual `legalEntityId` | 200, exactly its seeded nonempty request with matching real ID, distinct reason and requester; `canReview=false` |
| Either attacker reads the actual victim organization and actual victim legal entity | 403, no victim marker |
| Attacker A's genuine response is evaluated as attacker B's own response | Proof rejects it |
| Serialized own response includes the synthetic envelope value or extra PII | Proof rejects it |
| Changes to victim organization/employee/org-unit/legal-entity/audit rows | Existing shared database snapshot rejects them |

This proposal does **not** independently snapshot pending registration requests on the victim side. A separate reviewer may require a specific table snapshot before acceptance.

The API's `versions` array is required to be empty because **no approved historical version is seeded**. This proof deliberately does **not** claim acceptance of version history, registration update/approval/rejection, intra-tenant role privilege escalation, header/query selector conflicts, crypto, or any write method.

## Checks and blockers

- [x] `node --check` on the two new `.mjs` files (Node 22).
- [x] `node --test tests/tenant-registration-changes-family.test.mjs`: **4/4 local source checks**.
- [ ] Exact-head **Tenant table proof** GitHub workflow: real localhost application HTTP plus disposable PG16 on the `multi-entity` profile, and green other profiles.
- [ ] Full CI, source GAP factory, CodeQL/security and independent maintainer review of the actual HTTP and DB evidence.
- [ ] Any additional victim registration-table immutability and approved-version proof requested by security review.

**DRAFT / NOT ACCEPTED / DO NOT MERGE / ZERO NEW CREDITS.** Keep the manifest method GAP until independent exact-head acceptance and coordinated reconciliation. Global tenant isolation, production regulatory configuration and payroll release remain NO-GO.

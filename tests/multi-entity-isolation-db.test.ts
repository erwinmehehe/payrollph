import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  assets, employeeEntityBankAccounts, employeeEntityAssignments, employees, hcmEmploymentTerms,
  legalEntities, legalEntityProfileChangeRequests, legalEntityStatutoryRegistrations,
  legalEntityTransferLiabilityEvidence, entityTransferRequests, organizations, orgUnits,
  provisioningTasks, userEntityPreferences, userLegalEntityGrants, userOrganizations, users,
  workerEffectiveChanges, workerEmploymentEvents,
} from "../src/db/schema";
import { resolveMultiEntityContext, assertEntityResource } from "../src/lib/multi-entity-server";
import { assertMembership, getAccess } from "../src/lib/access";
import { ensurePrimaryLegalEntity } from "../src/lib/legal-entity";
import { loadPeopleOperationsInbox } from "../src/lib/hcm-people-operations-inbox-server";
import { loadEmploymentLifecycleReadiness } from "../src/lib/hcm-lifecycle-readiness-server";
import { applyWorkerEffectiveChange, runScheduledWorkerEffectiveChanges, validHcmIsoDate } from "../src/lib/hcm-effective-changes";
import { employeeScopePredicate } from "../src/lib/multi-entity-personnel-scope";
import { encryptBankAccount } from "../src/lib/bank-account-crypto";
import { encryptGovernmentId } from "../src/lib/government-id-crypto";

/** Real PostgreSQL and Drizzle: two tenants, two employers, group and scoped HR. */
test("multi-entity service rejects cross-entity and cross-tenant reads and ID enumeration", async () => {
  const previous = process.env.MULTI_ENTITY_ENABLED;
  process.env.MULTI_ENTITY_ENABLED = "true";
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const [tenantA, tenantB] = await db.insert(organizations).values([
    { name: "Scope A " + suffix, legalName: "Scope A " + suffix },
    { name: "Scope B " + suffix, legalName: "Scope B " + suffix },
  ]).returning();
  const members: number[] = [];
  try {
    const [a1, a2, b1] = await db.insert(legalEntities).values([
      { organizationId: tenantA.id, code: "A1", legalName: "A1 " + suffix, displayName: "A1", primaryEntity: true },
      { organizationId: tenantA.id, code: "A2", legalName: "A2 " + suffix, displayName: "A2" },
      { organizationId: tenantB.id, code: "B1", legalName: "B1 " + suffix, displayName: "B1", primaryEntity: true },
    ]).returning();
    const people = await db.insert(users).values([
      { name: "Scoped " + suffix, email: "scoped-"+suffix+"@example.test", passwordHash: "synthetic", role: "hr" },
      { name: "Group " + suffix, email: "group-"+suffix+"@example.test", passwordHash: "synthetic", role: "group_hr" },
      { name: "Foreign " + suffix, email: "foreign-"+suffix+"@example.test", passwordHash: "synthetic", role: "owner" },
      { name: "Owner " + suffix, email: "owner-"+suffix+"@example.test", passwordHash: "synthetic", role: "owner" },
    ]).returning();
    members.push(...people.map(p=>p.id));
    await db.insert(userOrganizations).values([
      { userId: people[0].id, organizationId: tenantA.id, role: "hr", active: true },
      { userId: people[1].id, organizationId: tenantA.id, role: "group_hr", active: true },
      { userId: people[2].id, organizationId: tenantB.id, role: "owner", active: true },
      { userId: people[3].id, organizationId: tenantA.id, role: "owner", active: true },
    ]);
    await db.insert(userLegalEntityGrants).values({
      userId: people[0].id, organizationId: tenantA.id, legalEntityId: a1.id,
    });
    const [worker1, worker2, foreignWorker] = await db.insert(employees).values([
      { organizationId: tenantA.id, legalEntityId: a1.id, employeeNo: "A1", firstName: "Alpha", lastName: "Staff", title: "Staff", avatarInitials: "AS", basicRate: "20000", startDate: "2026-01-01" },
      { organizationId: tenantA.id, legalEntityId: a2.id, employeeNo: "A2", firstName: "Beta", lastName: "Staff", title: "Staff", avatarInitials: "BS", basicRate: "30000", startDate: "2026-01-01" },
      { organizationId: tenantB.id, legalEntityId: b1.id, employeeNo: "B1", firstName: "Foreign", lastName: "Staff", title: "Staff", avatarInitials: "FS", basicRate: "40000", startDate: "2026-01-01" },
    ]).returning();
    // Synthetic HCM source rows exercise actual SQL joins, not only the
    // outer employee filter. Each source belongs to a different employer.
    await db.insert(hcmEmploymentTerms).values([
      { organizationId: tenantA.id, employeeId: worker1.id,
        employmentType: "Contractual", termKind: "fixed_term", effectiveFrom: "2026-01-01",
        contractEndDate: "2026-10-16", status: "active",
        reason: "Synthetic A1 source isolation", requestedBy: "Fixture QA" },
      { organizationId: tenantA.id, employeeId: worker2.id,
        employmentType: "Contractual", termKind: "fixed_term", effectiveFrom: "2026-01-01",
        contractEndDate: "2026-10-17", status: "active",
        reason: "Synthetic A2 source isolation", requestedBy: "Fixture QA" },
      { organizationId: tenantB.id, employeeId: foreignWorker.id,
        employmentType: "Contractual", termKind: "fixed_term", effectiveFrom: "2026-01-01",
        contractEndDate: "2026-10-18", status: "active",
        reason: "Synthetic foreign tenant source isolation", requestedBy: "Fixture QA" },
    ]);
    await db.insert(provisioningTasks).values([
      { organizationId: tenantA.id, employeeId: worker1.id, kind: "onboarding", title: "A1 HR task" },
      { organizationId: tenantA.id, employeeId: worker2.id, kind: "onboarding", title: "A2 HR task" },
      { organizationId: tenantB.id, employeeId: foreignWorker.id, kind: "onboarding", title: "Foreign HR task" },
    ]);
    await db.insert(assets).values([
      { organizationId: tenantA.id, employeeId: worker1.id, type: "Laptop", name: "A1 fixture asset" },
      { organizationId: tenantA.id, employeeId: worker2.id, type: "Laptop", name: "A2 fixture asset" },
      { organizationId: tenantB.id, employeeId: foreignWorker.id, type: "Laptop", name: "Foreign fixture asset" },
    ]);
    // An employee record can never be used as a foreign-tenant assignment or
    // transfer, even if the source/target legal employers are locally valid.
    await assert.rejects(async () => {
      await db.insert(employeeEntityAssignments).values({
        organizationId: tenantA.id, employeeId: foreignWorker.id,
        legalEntityId: a1.id, effectiveFrom: "2026-01-01",
      });
    }, "Worker assignment must match the employee's tenant");
    await assert.rejects(async () => {
      await db.insert(entityTransferRequests).values({
        organizationId: tenantA.id, employeeId: foreignWorker.id,
        fromLegalEntityId: a1.id, toLegalEntityId: a2.id,
        effectiveDate: "2026-11-01", reason: "Synthetic forbidden transfer",
        serviceStartDate: foreignWorker.startDate,
        leaveSnapshot: [], thirteenthSnapshot: {},
        continuityNote: "Never create this event",
        requestedByUserId: people[3].id,
      });
    }, "Transfer worker identity must match the tenant");

    // The newly staged registration and destination tables reject foreign
    // tenant/employer IDs even if an application caller supplies guessed IDs.
    const sealedProfile = encryptGovernmentId(JSON.stringify({ birTin: "123456789" }), {
      required: true, env: { ...process.env, PII_ENCRYPTION_KEY: "2".repeat(64) },
    });
    assert.ok(sealedProfile?.startsWith("enc:govid:v1:"));
    const proposal = {
      organizationId: tenantA.id, legalEntityId: a1.id,
      expectedEntityUpdatedAt: new Date(), effectiveDate: "2026-10-12",
      changedFields: ["birTin"], profileEnvelope: sealedProfile!,
      reason: "Synthetic employer registration exercise",
      requestedByUserId: people[3].id,
    };
    const [legitimate] = await db.insert(legalEntityProfileChangeRequests)
      .values(proposal).returning();
    assert.equal(legitimate.organizationId, tenantA.id);
    await assert.rejects(async () => {
      await db.insert(legalEntityProfileChangeRequests).values({
        ...proposal, legalEntityId: b1.id,
      });
    }, "Cross-tenant employer registration FK must reject the write");
    const sealedBank = encryptBankAccount("123456789000", {
      ...process.env, BANK_DATA_ENCRYPTION_KEY: "3".repeat(64),
    });
    assert.ok(sealedBank?.startsWith("enc:v1:"));
    await assert.rejects(async () => {
      await db.insert(employeeEntityBankAccounts).values({
        organizationId: tenantA.id, legalEntityId: a1.id,
        employeeId: foreignWorker.id,
        bankCode: "BPI", accountName: "Synthetic worker",
        accountEnvelope: sealedBank!,
        effectiveFrom: "2026-10-12",
      });
    }, "Employee payout destination must reject a worker from another tenant");
    // Match an approved registration version to the *same* tenant, employer
    // and source change request. Numeric request IDs from another tenant or
    // legal employer must not be accepted as historical registration evidence.
    const [foreignProposal] = await db.insert(legalEntityProfileChangeRequests)
      .values({
        ...proposal, organizationId: tenantB.id, legalEntityId: b1.id,
        requestedByUserId: people[2].id,
      }).returning();
    const [otherEmployerProposal] = await db.insert(legalEntityProfileChangeRequests)
      .values({ ...proposal, legalEntityId: a2.id }).returning();
    const [validVersion] = await db.insert(legalEntityStatutoryRegistrations)
      .values({
        organizationId: tenantA.id, legalEntityId: a1.id,
        revision: 1, effectiveDate: "2026-10-12", profileEnvelope: sealedProfile!,
        approvedByUserId: people[3].id, sourceChangeId: legitimate.id,
      }).returning();
    assert.equal(validVersion.sourceChangeId, legitimate.id);
    for (const sourceChangeId of [foreignProposal.id, otherEmployerProposal.id]) {
      await assert.rejects(async () => {
        await db.insert(legalEntityStatutoryRegistrations).values({
          organizationId: tenantA.id, legalEntityId: a1.id,
          revision: 2, effectiveDate: "2026-10-13", profileEnvelope: sealedProfile!,
          approvedByUserId: people[3].id, sourceChangeId,
        });
      }, "Immutable version source must match tenant and legal employer");
    }

    const [transfer] = await db.insert(entityTransferRequests).values({
      organizationId: tenantA.id, employeeId: worker1.id,
      fromLegalEntityId: a1.id, toLegalEntityId: a2.id,
      effectiveDate: "2026-11-01", reason: "Synthetic service-continuity exercise",
      serviceStartDate: worker1.startDate, leaveSnapshot: [],
      thirteenthSnapshot: {}, continuityNote: "No wage liability moved",
      requestedByUserId: people[3].id,
    }).returning();
    const validEvidence = {
      organizationId: tenantA.id, employeeId: worker1.id,
      transferRequestId: transfer.id,
      fromLegalEntityId: a1.id, toLegalEntityId: a2.id,
    };
    const [acceptedEvidence] = await db.insert(legalEntityTransferLiabilityEvidence)
      .values(validEvidence).returning();
    assert.equal(acceptedEvidence.transferRequestId, transfer.id);
    // A bare "reviewed" state is never proof of employment liability.
    await assert.rejects(async () => {
      await db.update(legalEntityTransferLiabilityEvidence)
        .set({ reviewState: "reviewed" })
        .where(eq(legalEntityTransferLiabilityEvidence.id, acceptedEvidence.id));
    }, "Reviewed liability requires a reviewer, approval time and sealed evidence");
    // A same-tenant but WRONG employee ID or swapped employers must also fail.
    for (const invalid of [
      { ...validEvidence, employeeId: worker2.id },
      { ...validEvidence, fromLegalEntityId: a2.id, toLegalEntityId: a1.id },
      { ...validEvidence, fromLegalEntityId: b1.id },
    ]) {
      await assert.rejects(async () => {
        await db.insert(legalEntityTransferLiabilityEvidence).values(invalid);
      }, "Liability evidence cannot reassign a different worker or payer");
    }

    await db.delete(legalEntityTransferLiabilityEvidence)
      .where(eq(legalEntityTransferLiabilityEvidence.id, acceptedEvidence.id));
    await db.delete(entityTransferRequests)
      .where(eq(entityTransferRequests.id, transfer.id));
    await db.delete(legalEntityStatutoryRegistrations)
      .where(eq(legalEntityStatutoryRegistrations.id, validVersion.id));
    await db.delete(legalEntityProfileChangeRequests)
      .where(inArray(legalEntityProfileChangeRequests.id,
        [legitimate.id, foreignProposal.id, otherEmployerProposal.id]));

    const scoped = await resolveMultiEntityContext({
      userId: people[0].id, organizationId: tenantA.id, requested: a1.id,
    });
    assert.equal(scoped.ok, true);
    if (!scoped.ok) throw new Error("unexpected deny");
    assert.equal(assertEntityResource(scoped.context, worker1.legalEntityId), null);
    assert.equal(assertEntityResource(scoped.context, worker2.legalEntityId)?.status, 403);
    assert.equal(assertEntityResource(scoped.context, foreignWorker.legalEntityId)?.status, 403);

    // A real authenticated role+grant context must authorize matching sources,
    // but refuse conflicting body/header/query employer IDs BEFORE reading
    // employer grants, even if the header alone names a granted employer.
    const scopeUrl = (query: string) =>
      "https://localhost.example/api/multi-entity/context?organizationId=" +
        tenantA.id + "&" + query;
    const matching = await resolveMultiEntityContext({
      userId: people[0].id, organizationId: tenantA.id, requested: a1.id,
      request: new Request(scopeUrl("legalEntityId=" + a1.id), {
        headers: { "x-legal-entity-id": String(a1.id) },
      }),
    });
    assert.equal(matching.ok, true, "Matching explicit selectors preserve legitimate own-employer access");
    if (matching.ok) assert.equal(matching.context.legalEntityId, a1.id);
    for (const [label, requested, query, header, expectedCode] of [
      ["header versus URL", undefined, "legalEntityId=" + a2.id, String(a1.id), "ENTITY_SELECTOR_CONFLICT"],
      ["argument versus header", a1.id, "legalEntityId=" + a1.id, String(a2.id), "ENTITY_SELECTOR_CONFLICT"],
      ["two URL parameters", undefined,
        "legalEntityId=" + a1.id + "&legalEntityId=" + a1.id, null, "ENTITY_SELECTOR_INVALID"],
      ["malformed numeric alias", undefined, "legalEntityId=0xB", null, "ENTITY_SELECTOR_INVALID"],
      ["foreign tenant header", undefined, "legalEntityId=" + a1.id, String(b1.id), "ENTITY_SELECTOR_CONFLICT"],
      ["All versus selected", "all", "legalEntityId=" + a1.id, null, "ENTITY_SELECTOR_CONFLICT"],
    ] as const) {
      const attempt = await resolveMultiEntityContext({
        userId: people[0].id, organizationId: tenantA.id, requested,
        request: new Request(scopeUrl(query), {
          ...(header == null ? {} : { headers: { "x-legal-entity-id": header } }),
        }),
      });
      assert.equal(attempt.ok, false, label + ": mismatched selectors must never fall back");
      if (!attempt.ok) {
        assert.equal(attempt.response.status, 403, label);
        const payload = await attempt.response.json();
        assert.equal(payload.code, expectedCode, label + ": refuse before grant lookup");
        assert.ok(!JSON.stringify(payload).includes(String(b1.id)),
          label + ": never echo a foreign employer ID");
      }
    }
    for (const requested of [a2.id, b1.id, "all"]) {
      const attempt = await resolveMultiEntityContext({
        userId: people[0].id, organizationId: tenantA.id, requested,
      });
      assert.equal(attempt.ok, false);
      if (!attempt.ok) assert.equal(attempt.response.status, 403);
    }
    // Tenant ownership without an explicit employer grant cannot see All.
    const ownerAll = await resolveMultiEntityContext({
      userId: people[3].id, organizationId: tenantA.id, requested: "all",
    });
    assert.equal(ownerAll.ok, false);
    if (!ownerAll.ok) assert.equal(ownerAll.response.status, 403);
    await db.insert(userLegalEntityGrants).values({
      userId: people[3].id, organizationId: tenantA.id, legalEntityId: a1.id,
    });
    const ownerScoped = await resolveMultiEntityContext({
      userId: people[3].id, organizationId: tenantA.id, requested: a1.id,
    });
    assert.equal(ownerScoped.ok, true);
    if (ownerScoped.ok) {
      assert.equal(assertEntityResource(ownerScoped.context, a1.id), null);
      assert.equal(assertEntityResource(ownerScoped.context, a2.id)?.status, 403);
    }
    // A preference from a former group role or revoked grant must never
    // strand a newly scoped account or resurrect visibility into that entity.
    await db.insert(userEntityPreferences).values({
      userId: people[3].id, organizationId: tenantA.id, legalEntityId: null,
    });
    const staleGroupPreference = await resolveMultiEntityContext({
      userId: people[3].id, organizationId: tenantA.id,
    });
    assert.equal(staleGroupPreference.ok, true);
    if (staleGroupPreference.ok) {
      assert.equal(staleGroupPreference.context.legalEntityId, a1.id);
      assert.equal(staleGroupPreference.context.group, false);
    }
    await db.update(userEntityPreferences).set({ legalEntityId: a2.id })
      .where(and(eq(userEntityPreferences.organizationId, tenantA.id),
        eq(userEntityPreferences.userId, people[3].id)));
    const revokedPreference = await resolveMultiEntityContext({
      userId: people[3].id, organizationId: tenantA.id,
    });
    assert.equal(revokedPreference.ok, true);
    if (revokedPreference.ok) {
      assert.equal(revokedPreference.context.legalEntityId, a1.id);
      assert.equal(assertEntityResource(revokedPreference.context, a2.id)?.status, 403);
    }
    const explicitRevoked = await resolveMultiEntityContext({
      userId: people[3].id, organizationId: tenantA.id, requested: a2.id,
    });
    assert.equal(explicitRevoked.ok, false, "Explicit ungranted employer must never fall back");
    await db.delete(userEntityPreferences).where(and(
      eq(userEntityPreferences.organizationId, tenantA.id),
      eq(userEntityPreferences.userId, people[3].id),
    ));

    await db.insert(userLegalEntityGrants).values({
      userId: people[3].id, organizationId: tenantA.id, legalEntityId: a2.id,
    });
    const multiGrantedOwner = await resolveMultiEntityContext({
      userId: people[3].id, organizationId: tenantA.id,
    });
    assert.equal(multiGrantedOwner.ok, true);
    if (!multiGrantedOwner.ok) throw new Error("unexpected deny");
    assert.equal(multiGrantedOwner.context.canSwitch, true);
    assert.equal(multiGrantedOwner.context.group, false);
    assert.deepEqual(multiGrantedOwner.context.entities.map(e => e.id).sort((a,b) => a-b),
      [a1.id, a2.id]);
    assert.equal(assertEntityResource(multiGrantedOwner.context, a2.id)?.status, 403);
    const ownerSelectedA2 = await resolveMultiEntityContext({
      userId: people[3].id, organizationId: tenantA.id, requested: a2.id,
    });
    assert.equal(ownerSelectedA2.ok, true);
    if (ownerSelectedA2.ok) {
      assert.equal(assertEntityResource(ownerSelectedA2.context, a2.id), null);
      assert.equal(assertEntityResource(ownerSelectedA2.context, a1.id)?.status, 403);
    }
    const ownerAllEvenWithTwoGrants = await resolveMultiEntityContext({
      userId: people[3].id, organizationId: tenantA.id, requested: "all",
    });
    assert.equal(ownerAllEvenWithTwoGrants.ok, false);

    // An active tenant without exactly one PRIMARY is an unreconciled schema
    // state. The scope resolver must not silently choose A1 or a new payer.
    await db.update(legalEntities).set({ primaryEntity: false })
      .where(eq(legalEntities.id, a1.id));
    try {
      const noPrimary = await resolveMultiEntityContext({
        userId: people[3].id, organizationId: tenantA.id, requested: a1.id,
      });
      assert.equal(noPrimary.ok, false);
      if (!noPrimary.ok) {
        assert.equal(noPrimary.response.status, 409);
        const payload = await noPrimary.response.json() as Record<string, unknown>;
        assert.equal(payload.code, "ENTITY_PRIMARY_RECONCILIATION_REQUIRED");
      }
    } finally {
      await db.update(legalEntities).set({ primaryEntity: true })
        .where(eq(legalEntities.id, a1.id));
    }

    const group = await resolveMultiEntityContext({
      userId: people[1].id, organizationId: tenantA.id, requested: "all",
    });
    assert.equal(group.ok, true);
    if (!group.ok) throw new Error("unexpected deny");
    assert.deepEqual(group.context.entities.map(e=>e.id).sort((a,b)=>a-b), [a1.id,a2.id]);
    // Feature-OFF is a hard denial at BOTH shared access entrypoints, not
    // merely the new /api/multi-entity URL. Other tenant roles retain legacy
    // behavior without seeing a new group-wide capability by accident.
    process.env.MULTI_ENTITY_ENABLED = "false";
    try {
      assert.equal(await getAccess(people[1].id, tenantA.id), null);
      const deniedMembership = await assertMembership(people[1].id, tenantA.id);
      assert.equal(deniedMembership?.status, 403);
      assert.equal((await getAccess(people[3].id, tenantA.id))?.role, "owner");
    } finally {
      process.env.MULTI_ENTITY_ENABLED = "true";
    }
    assert.equal((await getAccess(people[1].id, tenantA.id))?.role, "group_hr");
    // Sanctioned resolver allows group reports, but blanket tenant membership
    // must not authorize unrelated legacy/API reads for the new group role.
    assert.equal((await assertMembership(people[1].id, tenantA.id))?.status, 403);
    // Executed regression: a dedicated group_hr role with an org-unit
    // restriction is NOT a tenant-wide cross-entity principal. It cannot
    // enumerate All or explicitly name another employer while narrowed.
    const [restrictedUnit] = await db.insert(orgUnits).values({
      organizationId: tenantA.id, code: "GR" + suffix.slice(0, 6),
      name: "Restricted " + suffix, type: "department",
    }).returning();
    await db.update(userOrganizations).set({ orgUnitId: restrictedUnit.id })
      .where(and(eq(userOrganizations.organizationId, tenantA.id),
        eq(userOrganizations.userId, people[1].id)));
    assert.equal(await getAccess(people[1].id, tenantA.id), null);
    assert.equal((await assertMembership(people[1].id, tenantA.id))?.status, 403);
    for (const requested of ["all", a1.id, a2.id]) {
      const restrictedGroup = await resolveMultiEntityContext({
        userId: people[1].id, organizationId: tenantA.id, requested,
      });
      assert.equal(restrictedGroup.ok, false, "org-unit group_hr cannot gain whole-entity access");
      if (!restrictedGroup.ok) {
        assert.equal(restrictedGroup.response.status, 403);
        const payload = await restrictedGroup.response.json() as Record<string, unknown>;
        assert.equal(payload.code, "ENTITY_ACCESS_DENIED");
        assert.equal(JSON.stringify(payload).includes("A2"), false);
      }
    }
    await db.update(userOrganizations).set({ orgUnitId: null })
      .where(and(eq(userOrganizations.organizationId, tenantA.id),
        eq(userOrganizations.userId, people[1].id)));
    const restoredGroup = await resolveMultiEntityContext({
      userId: people[1].id, organizationId: tenantA.id, requested: "all",
    });
    assert.equal(restoredGroup.ok, true, "only tenant-wide group HR may read both employers");
    const foreignEntity = await resolveMultiEntityContext({
      userId: people[1].id, organizationId: tenantA.id, requested: b1.id,
    });
    assert.equal(foreignEntity.ok, false);
    const noMembership = await resolveMultiEntityContext({
      userId: people[2].id, organizationId: tenantA.id, requested: a1.id,
    });
    assert.equal(noMembership.ok, false);
    // Queries for scoped roles must ALWAYS bind tenant and legal employer.
    const inScope = await db.select({ id: employees.id }).from(employees)
      .where(employeeScopePredicate({
        organizationId: tenantA.id,
        legalEntityId: scoped.context.legalEntityId!,
        orgUnitId: null,
      }));
    assert.deepEqual(inScope.map(row => row.id), [worker1.id]);
    assert.ok(!inScope.some(row => row.id === worker2.id || row.id === foreignWorker.id));
    // Real SQL regression for the People Operations worklist and lifecycle
    // endpoint: an HR grant for A1 must not reveal A2 or another tenant.
    // Direct/async library entrypoints must reject an omitted or invalid
    // employer under multi-entity mode instead of falling back to All.
    await assert.rejects(() => loadPeopleOperationsInbox(tenantA.id, {}, "2026-10-13"),
      /ENTITY_HCM_SCOPE_REQUIRED/);
    await assert.rejects(() => loadEmploymentLifecycleReadiness(tenantA.id, "2026-10-13"),
      /ENTITY_HCM_SCOPE_REQUIRED/);
    for (const invalid of [0, -1, Number.NaN, 1.5]) {
      await assert.rejects(() => loadPeopleOperationsInbox(tenantA.id, {}, "2026-10-13", invalid),
        /ENTITY_HCM_INVALID_EMPLOYER/);
      await assert.rejects(() => loadEmploymentLifecycleReadiness(tenantA.id, "2026-10-13", invalid),
        /ENTITY_HCM_INVALID_EMPLOYER/);
    }
    await assert.rejects(() => loadPeopleOperationsInbox(0, {}, "2026-10-13", a1.id),
      /ENTITY_HCM_ORGANIZATION_REQUIRED/);
    await assert.rejects(() => loadEmploymentLifecycleReadiness(0, "2026-10-13", a1.id),
      /ENTITY_HCM_ORGANIZATION_REQUIRED/);

    const scopedInbox = await loadPeopleOperationsInbox(tenantA.id, { pageSize: 50 },
      "2026-10-13", a1.id);
    assert.ok(scopedInbox.rows.length > 0);
    assert.ok(scopedInbox.rows.some(row => row.category === "onboarding"));
    assert.ok(scopedInbox.rows.every(row => row.employeeId === worker1.id));
    for (const name of ["Beta Staff", "Foreign Staff"]) {
      assert.ok(!JSON.stringify(scopedInbox).includes(name), `A1 leaked ${name}`);
    }
    const scopedLifecycle = await loadEmploymentLifecycleReadiness(
      tenantA.id, "2026-10-13", a1.id);
    assert.deepEqual(scopedLifecycle.rows.map(row => row.employeeId), [worker1.id]);
    assert.equal(scopedLifecycle.rows[0].dueDate, "2026-10-16");
    const otherInbox = await loadPeopleOperationsInbox(tenantA.id, { pageSize: 50 },
      "2026-10-13", a2.id);
    assert.ok(otherInbox.rows.length > 0, "A2 must contain actual source rows");
    assert.ok(otherInbox.rows.some(row => row.category === "onboarding"));
    assert.ok(otherInbox.rows.every(row => row.employeeId === worker2.id));
    assert.ok(!JSON.stringify(otherInbox).includes("Alpha Staff"));
    assert.ok(!JSON.stringify(otherInbox).includes("Foreign Staff"));
    const otherLifecycle = await loadEmploymentLifecycleReadiness(
      tenantA.id, "2026-10-13", a2.id);
    assert.deepEqual(otherLifecycle.rows.map(row => row.employeeId), [worker2.id]);
    assert.equal(otherLifecycle.rows[0].dueDate, "2026-10-17");
    // Naming a legal employer from tenant B while querying tenant A must not
    // pull tenant B's workers or dependent HCM source rows into the response.
    const foreignIdInbox = await loadPeopleOperationsInbox(tenantA.id, {},
      "2026-10-13", b1.id);
    assert.equal(foreignIdInbox.rows.length, 0);
    assert.equal(foreignIdInbox.summary.total, 0);
    const foreignIdLifecycle = await loadEmploymentLifecycleReadiness(
      tenantA.id, "2026-10-13", b1.id);
    assert.equal(foreignIdLifecycle.rows.length, 0);
    const foreignTenantInbox = await loadPeopleOperationsInbox(tenantB.id, {},
      "2026-10-13", b1.id);
    assert.ok(foreignTenantInbox.rows.length > 0);
    assert.ok(foreignTenantInbox.rows.every(row => row.employeeId === foreignWorker.id));

    // The release flag OFF retains legacy, tenant-wide HCM reads. It must
    // never pick up another tenant, even when two employers share the tenant.
    process.env.MULTI_ENTITY_ENABLED = "false";
    try {
      const legacyInbox = await loadPeopleOperationsInbox(tenantA.id, { pageSize: 50 },
        "2026-10-13");
      assert.deepEqual([...new Set(legacyInbox.rows.map(row => row.employeeId))].sort((x, y) => x - y),
        [worker1.id, worker2.id].sort((x, y) => x - y));
      const legacyLifecycle = await loadEmploymentLifecycleReadiness(tenantA.id, "2026-10-13");
      assert.deepEqual(legacyLifecycle.rows.map(row => row.employeeId).sort((x, y) => x - y),
        [worker1.id, worker2.id].sort((x, y) => x - y));
      assert.ok(!JSON.stringify(legacyInbox).includes("Foreign Staff"));
    } finally {
      process.env.MULTI_ENTITY_ENABLED = "true";
    }

    // A real scheduled HCM record must remain untouched even when a direct
    // worker or runner is called outside the guarded HTTP/scheduler surfaces.
    const [scheduled] = await db.insert(workerEffectiveChanges).values({
      organizationId: tenantA.id, employeeId: worker1.id,
      changeType: "employment_change", movementType: "status_change",
      status: "scheduled", effectiveDate: "2026-10-10",
      reason: "Synthetic frozen HCM queue entry", requestedBy: "Fixture QA",
    }).returning();
    const baselineLedger = await db.select({ id: workerEmploymentEvents.id }).from(workerEmploymentEvents)
      .where(and(eq(workerEmploymentEvents.organizationId, tenantA.id),
        eq(workerEmploymentEvents.employeeId, worker1.id)));
    assert.deepEqual(await applyWorkerEffectiveChange(scheduled.id), {
      skipped: true, reason: "ENTITY_HCM_DEFERRED",
    });
    assert.deepEqual(await runScheduledWorkerEffectiveChanges({
      now: new Date("2026-10-13T00:00:00Z"),
    }), [{ status: "skipped", reason: "ENTITY_HCM_DEFERRED" }]);
    const [stillScheduled] = await db.select({ status: workerEffectiveChanges.status,
      failure: workerEffectiveChanges.failure }).from(workerEffectiveChanges)
      .where(eq(workerEffectiveChanges.id, scheduled.id));
    assert.equal(stillScheduled.status, "scheduled");
    assert.equal(stillScheduled.failure, null);
    const [stillWorker] = await db.select({ status: employees.status }).from(employees)
      .where(eq(employees.id, worker1.id));
    assert.equal(stillWorker.status, "Active");
    const ledger = await db.select({ id: workerEmploymentEvents.id }).from(workerEmploymentEvents)
      .where(and(eq(workerEmploymentEvents.organizationId, tenantA.id),
        eq(workerEmploymentEvents.employeeId, worker1.id)));
    assert.deepEqual(ledger.map(row => row.id), baselineLedger.map(row => row.id),
      "A held worker must not create or alter employment events");
    // The same predicate is used by the real workspace loader. Group HR may
    // see both employers inside one tenant, NEVER the other tenant's rows.
    const inGroup = await db.select({ id: employees.id }).from(employees)
      .where(employeeScopePredicate({
        organizationId: tenantA.id, legalEntityId: null, orgUnitId: null,
      }));
    assert.deepEqual(inGroup.map(row => row.id).sort((a,b) => a-b),
      [worker1.id, worker2.id].sort((a,b) => a-b));
    assert.ok(!inGroup.some(row => row.id === foreignWorker.id));
  } finally {
    await db.delete(organizations).where(inArray(organizations.id, [tenantA.id, tenantB.id]));
    if (members.length) await db.delete(users).where(inArray(users.id, members));
    if (previous === undefined) delete process.env.MULTI_ENTITY_ENABLED;
    else process.env.MULTI_ENTITY_ENABLED = previous;
  }
});

// Every tenant must bootstrap a single PRIMARY and replay idempotently.
// Synthetic database only; this is NOT a historical Neon backfill rehearsal.
test("an empty tenant gets exactly one active PRIMARY under repeated bootstrap", async () => {
  const [tenant] = await db.insert(organizations).values({
    name: "Bootstrap " + randomUUID().slice(0, 12),
    legalName: "Bootstrap Legal",
  }).returning();
  try {
    const created = await ensurePrimaryLegalEntity(tenant.id);
    assert.ok(created?.primaryEntity && created.active);
    const again = await ensurePrimaryLegalEntity(tenant.id);
    assert.equal(again?.id, created?.id);
    const all = await db.select().from(legalEntities)
      .where(eq(legalEntities.organizationId, tenant.id));
    assert.equal(all.length, 1);
    assert.equal(all.filter(row => row.primaryEntity && row.active).length, 1);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, tenant.id));
  }
});

// Fail closed at the worker entrypoint, even if an API/scheduler caller is
// changed later. A deferred invocation must not query the HCM queue, claim
// work, or mark any previously scheduled change as failed.
test("multi-entity freeze blocks direct and scheduled HCM worker entrypoints without DB access", async () => {
  const previous = process.env.MULTI_ENTITY_ENABLED;
  process.env.MULTI_ENTITY_ENABLED = "true";
  try {
    assert.deepEqual(await applyWorkerEffectiveChange(-1), {
      skipped: true, reason: "ENTITY_HCM_DEFERRED",
    });
    assert.deepEqual(await runScheduledWorkerEffectiveChanges(), [
      { status: "skipped", reason: "ENTITY_HCM_DEFERRED" },
    ]);
  } finally {
    if (previous === undefined) delete process.env.MULTI_ENTITY_ENABLED;
    else process.env.MULTI_ENTITY_ENABLED = previous;
  }
});

// Structural defense-in-depth: route handlers are directly importable/callable
// without passing through the deployed Next.js proxy. Keep the 403 hold as the
// first decision in every deferred handler, including mutating routes.
test("all deferred HCM route handlers deny before auth and mutations", () => {
  const effective = readFileSync("src/app/api/hcm/effective-changes/route.ts", "utf8");
  assert.match(effective, /function rejectDeferredHcm\(\)/);
  assert.match(effective, /multiEntityHcmDeferred\(\)/);
  assert.match(effective, /code: "ENTITY_HCM_DEFERRED"/);
  assert.match(effective, /"Cache-Control": "private, no-store"/);
  for (const method of ["GET", "POST", "PATCH"]) {
    const start = effective.indexOf(`export async function ${method}(`);
    assert.ok(start >= 0, method);
    const section = effective.slice(start);
    const guard = section.indexOf("rejectDeferredHcm()");
    const session = section.indexOf("getSessionUser()");
    assert.ok(guard >= 0 && guard < session, `${method} must block before reading the session/DB`);
  }
  for (const path of [
    "src/app/api/hcm/lifecycle-readiness/route.ts",
    "src/app/api/hcm/people-operations-inbox/route.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    const start = source.indexOf("export async function GET(");
    assert.ok(start >= 0, path);
    const handler = source.slice(start);
    assert.ok(handler.indexOf("multiEntityHcmDeferred()") >= 0 &&
      handler.indexOf("multiEntityHcmDeferred()") < handler.indexOf("getSessionUser()"), path);
    assert.match(handler, /code: "ENTITY_HCM_DEFERRED"/);
    assert.match(handler, /"Cache-Control": "private, no-store"/);
    assert.match(handler, /organizationId, legalEntityId/,
      "A scoped response must identify the authorized employer for future UI validation");
  }
});

// Validate calendar semantics, not merely a regex shape. PostgreSQL should
// never be asked to interpret an impossible scheduled employment date.
test("effective-dated HCM requests accept real ISO calendar dates only", () => {
  for (const valid of ["2024-02-29", "2026-10-14", "2000-02-29", "9999-12-31"]) {
    assert.equal(validHcmIsoDate(valid), true, valid);
  }
  for (const invalid of [
    "", "2026-02-29", "2026-02-30", "2026-02-31", "1900-02-29",
    "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00",
    "2026-12-32", "0000-01-01", "2026-1-2", "2026-10-14T00:00:00Z",
  ]) {
    assert.equal(validHcmIsoDate(invalid), false, invalid);
  }
  const route = readFileSync("src/app/api/hcm/effective-changes/route.ts", "utf8");
  assert.match(route, /validHcmIsoDate\(effectiveDate\)/);
  assert.match(route, /Number\.isSafeInteger\(organizationId\)/);
  assert.match(route, /Number\.isSafeInteger\(employeeId\)/);
  assert.match(route, /Number\.isSafeInteger\(id\)/);
  assert.match(route, /Effective-dated HCM change not found/);
});

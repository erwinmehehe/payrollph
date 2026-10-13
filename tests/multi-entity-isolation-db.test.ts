import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  employeeEntityBankAccounts, employeeEntityAssignments, employees, legalEntities, legalEntityProfileChangeRequests,
  legalEntityStatutoryRegistrations, legalEntityTransferLiabilityEvidence, entityTransferRequests,
  organizations, orgUnits, userEntityPreferences, userLegalEntityGrants, userOrganizations, users,
} from "../src/db/schema";
import { resolveMultiEntityContext, assertEntityResource } from "../src/lib/multi-entity-server";
import { assertMembership, getAccess } from "../src/lib/access";
import { ensurePrimaryLegalEntity } from "../src/lib/legal-entity";
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
    // SQL predicate and HTTP isolation remain in this core PR; direct HCM
    // worklist/lifecycle service acceptance is preserved in stacked draft #963.
    // Those service signatures are deliberately unavailable in core while the
    // HCM API/SSR and scheduler holds remain active.
    const otherEmployer = await db.select({ id: employees.id }).from(employees)
      .where(employeeScopePredicate({
        organizationId: tenantA.id, legalEntityId: a2.id, orgUnitId: null,
      }));
    assert.deepEqual(otherEmployer.map(row => row.id), [worker2.id]);
    assert.ok(!otherEmployer.some(row => row.id === worker1.id || row.id === foreignWorker.id));
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

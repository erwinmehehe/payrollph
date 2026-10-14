import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees, hcmDocumentRequirements, hcmEmployeeDocumentCompliance,
  hcmPolicyAssignments, hcmPolicyVersions, organizations,
} from "../src/db/schema";
import {
  employeeDocumentRequirementJoin, employeePolicyVersionJoin,
} from "../src/lib/document-schema-compat";

test("ESS only joins published policies and document rules belonging to the employee's tenant", async () => {
  const token = randomUUID().slice(0, 12);
  const [orgA, orgB] = await db.insert(organizations).values([
    { name: "Fictional ESS scope A " + token, legalName: "Fictional ESS scope A " + token },
    { name: "Fictional ESS scope B " + token, legalName: "Fictional ESS scope B " + token },
  ]).returning();
  try {
    const [worker] = await db.insert(employees).values({
      organizationId: orgA.id, employeeNo: "ESSSCOPE" + token,
      firstName: "Fictional", lastName: "Worker", title: "Associate",
      avatarInitials: "FW", basicRate: "22000.00", startDate: "2026-01-01",
    }).returning();

    const [ownRule, foreignRule] = await db.insert(hcmDocumentRequirements).values([
      { organizationId: orgA.id, code: "own-" + token, name: "Owned requirement",
        kind: "contract", createdByName: "Synthetic QA" },
      { organizationId: orgB.id, code: "foreign-" + token,
        name: "PRIVATE FOREIGN REQUIREMENT", kind: "contract", createdByName: "Synthetic QA" },
    ]).returning();
    await db.insert(hcmEmployeeDocumentCompliance).values([
      { organizationId: orgA.id, employeeId: worker.id, requirementId: ownRule.id },
      // The historical FK is only requirement_id, so the foreign link is
      // syntactically valid despite the parent compliance organization.
      { organizationId: orgA.id, employeeId: worker.id, requirementId: foreignRule.id },
    ]);
    const rules = await db.select({ name: hcmDocumentRequirements.name })
      .from(hcmEmployeeDocumentCompliance)
      .innerJoin(hcmDocumentRequirements, employeeDocumentRequirementJoin)
      .where(and(
        eq(hcmEmployeeDocumentCompliance.organizationId, orgA.id),
        eq(hcmEmployeeDocumentCompliance.employeeId, worker.id),
      ));
    assert.deepEqual(rules.map(row => row.name), ["Owned requirement"]);

    const policies = await db.insert(hcmPolicyVersions).values([
      { organizationId: orgA.id, policyCode: "own-" + token,
        title: "Owned policy", version: "1", status: "published",
        effectiveFrom: "2026-01-01", content: "Owned private policy",
        contentSha256: "a".repeat(64), createdByName: "Synthetic QA" },
      { organizationId: orgB.id, policyCode: "foreign-" + token,
        title: "PRIVATE FOREIGN POLICY", version: "1", status: "published",
        effectiveFrom: "2026-01-01", content: "Private foreign policy content",
        contentSha256: "b".repeat(64), createdByName: "Synthetic QA" },
    ]).returning();
    await db.insert(hcmPolicyAssignments).values(policies.map(policy => ({
      organizationId: orgA.id, employeeId: worker.id, policyId: policy.id,
    })));
    const result = await db.select({ title: hcmPolicyVersions.title })
      .from(hcmPolicyAssignments)
      .innerJoin(hcmPolicyVersions, employeePolicyVersionJoin)
      .where(and(
        eq(hcmPolicyAssignments.organizationId, orgA.id),
        eq(hcmPolicyAssignments.employeeId, worker.id),
        eq(hcmPolicyVersions.status, "published"),
      ));
    assert.deepEqual(result.map(row => row.title), ["Owned policy"]);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, orgA.id));
    await db.delete(organizations).where(eq(organizations.id, orgB.id));
  }
});

test("ESS document GET and policy acknowledgement POST always use tenant-bound parent joins", () => {
  const route = readFileSync("src/app/api/self/documents/route.ts", "utf8");
  const source = readFileSync("src/lib/document-schema-compat.ts", "utf8");
  assert.equal(route.split(".innerJoin(hcmPolicyVersions, employeePolicyVersionJoin)").length - 1, 2,
    "Both policy listing and acknowledgement must validate assignment employer");
  assert.match(route, /\.innerJoin\(hcmDocumentRequirements, employeeDocumentRequirementJoin\)/);
  assert.match(source, /eq\(hcmPolicyAssignments\.organizationId, hcmPolicyVersions\.organizationId\)/);
  assert.match(source, /eq\(hcmEmployeeDocumentCompliance\.organizationId, hcmDocumentRequirements\.organizationId\)/);
});

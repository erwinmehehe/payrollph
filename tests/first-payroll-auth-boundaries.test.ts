import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";

test("legal-employer GET never bootstraps another tenant before verifying authority", () => {
 const source=readFileSync("src/app/api/legal-entities/route.ts","utf8");
 const get=source.slice(source.indexOf("export async function GET"),source.indexOf("export async function POST"));
 assert.ok(get.includes("const denied = await requireAdmin(user.id, organizationId);"));
 const fullReadAuth=get.lastIndexOf("const denied = await requireAdmin(user.id, organizationId);");
 const bootstrap=get.indexOf("await ensurePrimaryLegalEntity(organizationId)");
 assert.ok(fullReadAuth>=0 && bootstrap>fullReadAuth);
 const selector=get.slice(get.indexOf("if (selectorMode)"),fullReadAuth);
 assert.match(selector,/assertOrganizationRole/);
 assert.doesNotMatch(selector,/ensurePrimaryLegalEntity/);
});
test("first-payroll progress is filtered by company-wide authenticated role for GET and PATCH",()=>{
 const source=readFileSync("src/app/api/first-payroll/progress/route.ts","utf8");
 const get=source.slice(source.indexOf("export async function GET"),source.indexOf("export async function PATCH"));
 const patch=source.slice(source.indexOf("export async function PATCH"));
 assert.match(get,/assertMembership/);
 assert.match(get,/canReadFirstPayrollProgress\(access\.role\)/);
 assert.match(get,/access\?\.companyWide/);
 assert.match(patch,/assertMembership/);
 assert.match(patch,/canReadFirstPayrollProgress\(access\.role\)/);
 assert.match(patch,/enforceSameOriginMutation/);
 const lib=readFileSync("src/lib/first-payroll-progress.ts","utf8");
 assert.match(lib,/currentOwner!==role/);
 assert.match(lib,/eq\(userOrganizations\.active, true\)/);
 assert.match(lib,/pg_advisory_xact_lock/);
});
test("navigation disclosure owns a separate canonical PR; first payroll cannot add conflicting module SQL",()=>{
 assert.equal(existsSync("docs/engineering/migration-proposals/tenant-core-navigation.sql"),false);
 assert.equal(existsSync("src/app/api/workspace/modules/route.ts"),false);
 const org=readFileSync("src/db/schema.ts","utf8");
 assert.doesNotMatch(org,/moduleVisibility:.*module_visibility/);
 assert.match(org,/firstPayrollJourneyProgress/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { explicitPayrollReviewEmployerId } from "../src/lib/tenant-payroll-review-page";

test("tax review employer selector requires one canonical safe positive id", () => {
  assert.equal(explicitPayrollReviewEmployerId("1"), 1);
  assert.equal(explicitPayrollReviewEmployerId("9007199254740991"), Number.MAX_SAFE_INTEGER);
  for (const forged of [undefined, null, 1, 0, false, "", "0", "-1", "+1",
    "01", "1e2", "1.0", " 1", "1 ", "1&organizationId=2",
    "9007199254740992", ["1"], ["1", "2"], {}, NaN, Infinity]) {
    assert.equal(explicitPayrollReviewEmployerId(forged), null, JSON.stringify(forged));
  }
});

for (const file of [
  "src/app/workspace/2316/page.tsx",
  "src/app/workspace/prior-employer/page.tsx",
]) {
  test(file + " enforces tenant, custom permissions, company scope before client mount", () => {
    const source = readFileSync(file, "utf8");
    const session = source.indexOf("await getSessionUser()");
    const selector = source.indexOf("explicitPayrollReviewEmployerId(query.organizationId)");
    const denied = source.indexOf("await assertOrganizationRole(");
    const access = source.indexOf("await getAccess(");
    const render = source.indexOf(file.includes("2316") ? "<Certificate2316Review" : "<YearEndPriorReview");
    assert.ok(session >= 0 && selector > session && denied > selector &&
      access > denied && render > access, "Private form must mount only after full server authorization");
    assert.match(source, /if \(denied \|\| !access\?\.companyWide\) notFound\(\)/);
    assert.match(source, /PAYROLL_OPERATOR_ROLES/);
    assert.match(source, /Authorized payroll employer: #\{organizationId\}/);
    assert.doesNotMatch(source, /Number\(query\.organizationId\)/);
    assert.match(source, /query\.organizationId === undefined/);
  });
}

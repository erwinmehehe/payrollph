import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultEmployerBenefitPlans, parseCatalogEmployerId,
} from "../src/lib/benefit-catalog-tenant";

test("catalog accepts only canonical positive employer IDs", () => {
  assert.equal(parseCatalogEmployerId(1), 1);
  assert.equal(parseCatalogEmployerId("93"), 93);
  assert.equal(parseCatalogEmployerId(2147483647), 2147483647);
  for (const input of [
    null, undefined, true, false, [], [1], {}, { value: 1 }, 0, -1,
    1.1, NaN, Infinity, -Infinity, 2147483648,
    "", " ", "01", "0", "-1", "+1", "1e2", "0x10", "1.0", "1 ", " 1",
    "2147483648", "99999999999999999999999999",
  ]) {
    assert.equal(parseCatalogEmployerId(input), null, String(input));
  }
});

test("all existing five defaults are attached to the request employer, never global", () => {
  const one = defaultEmployerBenefitPlans(41);
  const two = defaultEmployerBenefitPlans(88);
  assert.equal(one.length, 5);
  assert.deepEqual(one.map(row => row.name), [
    "HMO, Maxicare Plan A", "Group life & accident",
    "Pag-IBIG MP2", "SSS Flexi-Fund", "Rice allowance",
  ]);
  assert.deepEqual(one.map(row => row.organizationId), [41, 41, 41, 41, 41]);
  assert.deepEqual(two.map(row => row.organizationId), [88, 88, 88, 88, 88]);
  assert.deepEqual(one.map(({ organizationId, ...rest }) => rest),
    two.map(({ organizationId, ...rest }) => rest),
    "tenant identity must be the only difference in canonical defaults");
  assert.equal(one[0].employeeShare, "1500.00");
  assert.equal(one[0].employerShare, "2500.00");
  assert.equal(one[2].cap, "5000.00");
  assert.equal(one[4].employerShare, "1000.00");
  one[0].name = "Local unit test changed";
  assert.equal(defaultEmployerBenefitPlans(41)[0].name, "HMO, Maxicare Plan A",
    "callers cannot mutate the next employer's seed template");
});

test("invalid employer identity cannot generate global/foreign default plans", () => {
  for (const id of [0, -1, 1.5, NaN, Infinity, 2147483648]) {
    assert.throws(() => defaultEmployerBenefitPlans(id),
      /BENEFIT_CATALOG_EMPLOYER_REQUIRED/);
  }
});

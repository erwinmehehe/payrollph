import assert from "node:assert/strict";
import test from "node:test";
import { taxWithheldFromLineItems } from "../src/lib/exporters";
import { computePhilHealth } from "../src/lib/payroll-rules";

test("PhilHealth odd centavo is allocated to the employer share", () => {
  const result = computePhilHealth(10_001);

  assert.equal(result.base, 10_001);
  assert.equal(result.total, 500.05);
  assert.equal(result.employee, 250.02);
  assert.equal(result.employer, 250.03);
  assert.equal(Number((result.employee + result.employer).toFixed(2)), result.total);
});

test("year-end tax refunds reduce and collections increase BIR journal liability", () => {
  assert.equal(
    taxWithheldFromLineItems([
      { code: "WHT", amount: "-1000.00" },
      { code: "YE-TAX-REFUND", amount: "150.00" },
    ]),
    850,
  );

  assert.equal(
    taxWithheldFromLineItems([
      { code: "WHT", amount: "-1000.00" },
      { code: "YE-TAX-COLLECTION", amount: "-150.00" },
    ]),
    1150,
  );
});

test("year-end tax liability helper sums multiple WHT and YE-TAX lines deterministically", () => {
  assert.equal(
    taxWithheldFromLineItems([
      { code: "WHT", amount: "-700.00" },
      { code: "WHT", amount: "-300.00" },
      { code: "YE-TAX-REFUND", amount: "25.50" },
      { code: "YE-TAX-COLLECTION", amount: "-10.25" },
      { code: "HDMF", amount: "-200.00" },
    ]),
    984.75,
  );
});

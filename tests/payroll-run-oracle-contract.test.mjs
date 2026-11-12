import assert from "node:assert/strict";
import test from "node:test";
import { ORACLE_METHODS, assertRunIndistinguishable } from "../scripts/qa/payroll-run-oracle-contract.mjs";

const reply = (status = 404, error = "Payroll run not found.", headers = {}) => ({
  status, text: JSON.stringify({ error }), json: { error }, headers: new Headers(headers),
});
test("oracle regression requires identical real 404s, not any convenient denial", () => {
  assertRunIndistinguishable(reply(), reply(), ["VICTIM-MARKER"]);
  for (const bad of [reply(403), reply(200), reply(404, "Different employer"),
    reply(404, "VICTIM-MARKER"), reply(404, undefined, { location: "/login" }),
    reply(404, undefined, { "set-cookie": "session=forbidden" })])
    assert.throws(() => assertRunIndistinguishable(bad, reply(), ["VICTIM-MARKER"]));
});
test("every addressed method, including root and both modes of shared contexts, has a case", () => {
  assert.equal(ORACLE_METHODS.length, 19);
  assert.equal(new Set(ORACLE_METHODS.map(row => row.join(" "))).size, 19);
  for (const suffix of ["exports", "close", "payout-reconciliation", "xendit-payout"])
    for (const verb of ["GET", "POST"])
      assert.ok(ORACLE_METHODS.some(([method, path]) => method === verb && (path === suffix || path.startsWith(suffix + "?"))));
  assert.ok(ORACLE_METHODS.some(([method, path]) => method === "GET" && path === "ROOT"));
});

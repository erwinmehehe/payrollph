import assert from "node:assert/strict";
import test from "node:test";
import { readPayrollEmployerOptions } from "../src/lib/payroll-employer-options";

const row = { id: 7, code: "PRIMARY", displayName: "Fictional employer", primaryEntity: true };
const signal = new AbortController().signal;
const reply = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as typeof fetch;

test("selector executes one scoped read, retains its signal and excludes inactive employers", async () => {
  const calls: unknown[] = [];
  const result = await readPayrollEmployerOptions(42, signal, (async (url, options) => {
    calls.push(url);
    assert.equal(options?.signal, signal);
    assert.equal(options?.cache, "no-store");
    assert.equal(options?.method, undefined);
    return Response.json({ legalEntities: [row, { ...row, id: 8, active: false }] });
  }) as typeof fetch);
  assert.deepEqual(calls, ["/api/legal-entities?organizationId=42&mode=selector"]);
  assert.deepEqual(result, [row]);
  assert.deepEqual(await readPayrollEmployerOptions(42, signal, reply({ legalEntities: [] })), []);
});

test("failed or malformed employer reads reject instead of becoming empty setup", async () => {
  for (const status of [401, 403, 500]) await assert.rejects(readPayrollEmployerOptions(42, signal, reply({}, status)));
  for (const body of [null, {}, { legalEntities: null }, { legalEntities: [null] },
    { legalEntities: [{ ...row, id: 0 }] }, { legalEntities: [{ ...row, primaryEntity: "true" }] },
    { legalEntities: [{ ...row, active: "true" }] }, { legalEntities: [row, row] }]) {
    await assert.rejects(readPayrollEmployerOptions(42, signal, reply(body)));
  }
  await assert.rejects(readPayrollEmployerOptions(42, signal, (async () => new Response("{")) as typeof fetch));
  await assert.rejects(readPayrollEmployerOptions(42, signal, (async () => { throw new Error("offline"); }) as typeof fetch));
});

test("a later retry can recover after a transport failure", async () => {
  let calls = 0;
  const fetcher = (async () => ++calls === 1 ? new Response(null, { status: 503 }) : Response.json({ legalEntities: [row] })) as typeof fetch;
  await assert.rejects(readPayrollEmployerOptions(42, signal, fetcher));
  assert.deepEqual(await readPayrollEmployerOptions(42, signal, fetcher), [row]);
});

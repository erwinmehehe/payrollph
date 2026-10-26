import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { auditBusinessSnapshot, seedTableRow, readAllowlistPreseed } from "../scripts/qa/tenant-table-invariants.mjs";

const audit = { id: 7, organizationId: 9, actor: "fictional-owner", action: "review",
  resource: "fictional-item", metadata: { marker: "fictional-victim" }, createdAt: "2026-01-05T00:00:00Z",
  chainSeq: null, prevHash: null, rowHash: null };

test("audit comparison ignores only sealer bookkeeping and detects every business-field mutation", () => {
  const baseline = auditBusinessSnapshot([audit]);
  assert.deepEqual(auditBusinessSnapshot([{ ...audit, chainSeq: 1, prevHash: "previous", rowHash: "sealed" }]), baseline);
  for (const key of ["id", "organizationId", "actor", "action", "resource", "metadata", "createdAt"]) {
    const changed = { ...audit, [key]: key === "metadata" ? { marker: "changed" } : "changed" };
    assert.notDeepEqual(auditBusinessSnapshot([changed]), baseline, key + " must remain protected");
  }
  assert.notDeepEqual(auditBusinessSnapshot([{ ...audit, futureBusinessField: "changed" }]), baseline);
  assert.notDeepEqual(auditBusinessSnapshot([]), baseline);
});

const employers = () => ["VICTIM", "ATTA", "ATTB"].map((label) => ({ label, seeded: {} }));
test("route seeds insert both attackers before the real higher-ID victim", async () => {
  const contexts = employers(); const order = []; let id = 41;
  await seedTableRow({ key: "PATCH fictional", seed: async (employer) => {
    order.push(employer.label); return { id: id++ };
  } }, contexts);
  assert.deepEqual(order, ["ATTA", "ATTB", "VICTIM"]);
  assert.deepEqual(contexts.map((e) => e.seeded["PATCH fictional"].id), [43, 41, 42]);
});

test("target-ID guard refuses shared, lower, missing and invalid victim targets", async () => {
  for (const victim of [{ id: 1 }, { id: 2 }, {}, { id: null }, { id: -1 }, { id: "3" }]) {
    await assert.rejects(seedTableRow({ key: "PATCH fictional", seed: async (e) =>
      e.label === "VICTIM" ? victim : { id: e.label === "ATTA" ? 1 : 2 } }, employers()), /target ID/);
  }
});

test("non-ID seeds remain valid without manufacturing a target ID", async () => {
  for (const value of [true, ["fictional-module"], { marker: "fictional" }, undefined]) {
    await seedTableRow({ key: "GET fictional", seed: async () => value }, employers());
  }
});

test("both executable runners use the guarded seed order and full audit projection", () => {
  for (const name of ["tenant-table-http.mjs", "tenant-write-table-http.mjs"]) {
    const source = readFileSync(new URL("../scripts/qa/" + name, import.meta.url), "utf8");
    assert.match(source, /await seedTableRow\(item, employers\)/);
    assert.doesNotMatch(source, /for \(const e of employers\) e\.seeded/);
  }
  const source = readFileSync(new URL("../scripts/qa/tenant-table-http.mjs", import.meta.url), "utf8");
  assert.match(source, /db\.select\(\)\.from\(auditEvents\).*\.then\(auditBusinessSnapshot\)/);
  const workflow = readFileSync(new URL("../.github/workflows/tenant-table-proof.yml", import.meta.url), "utf8");
  assert.match(workflow, /types: \[opened, synchronize, reopened, edited, ready_for_review\]/);
  assert.match(workflow, /profile: \[default, multi-entity, flagged-reads, allowlisted-reads\]/);
});

test("preseed loader validates real synthetic IDs, signed-in cookies, allowlist victim and private 0600 file", () => {
  const directory = mkdtempSync(join(tmpdir(), "payrollph-tenant-allowlist-"));
  const file = join(directory, "fixture.json");
  const cookie = "__Host-linaw_session=" + "a".repeat(64);
  const employer = (label, id) => ({ org: { id }, entity: { id }, unit: { id },
    worker: { id }, owner: { id, name: "TTBL-" + label + "-nonce owner" },
    marker: "TTBL-" + label + "-nonce", cookie, rank: id, seeded: {} });
  const data = { schema: "payrollph-tenant-allowlist-preseed-v1",
    employers: [employer("VICTIM", 30), employer("ATTA", 10), employer("ATTB", 20)],
    excluded: employer("UNLISTED", 40), allowlistedIds: [10, 20, 30] };
  const env = { TENANT_TABLE_PROFILE: "allowlisted-reads" };
  for (const key of ["HCM_TEAM_LEAVE_CALENDAR_ORG_IDS", "HCM_PROCESS_MONITOR_ORG_IDS",
    "HCM_ORG_EXPLORER_ORG_IDS", "HCM_MANAGER_DECISION_INBOX_ORG_IDS",
    "WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS",
    "WFM_HISTORICAL_OUTLOOK_ALLOWED_ORGANIZATION_IDS",
    "WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS"]) env[key] = "10,20,30";
  try {
    writeFileSync(file, JSON.stringify(data), { mode: 0o600, flag: "wx" });
    assert.deepEqual(readAllowlistPreseed(file, env).map(e => e.org.id), [30, 10, 20]);
    assert.throws(() => readAllowlistPreseed(file, { ...env, HCM_PROCESS_MONITOR_ORG_IDS: "10,20" }),
      /must include victim/);
    const altered = { ...data, allowlistedIds: [10, 20] };
    writeFileSync(file, JSON.stringify(altered));
    assert.throws(() => readAllowlistPreseed(file, env));
    writeFileSync(file, JSON.stringify(data));
    chmodSync(file, 0o644);
    assert.throws(() => readAllowlistPreseed(file, env), /0600/);
    // A symlink must never be followed, even to another private 0600 file.
    unlinkSync(file);
    writeFileSync(join(directory, "target.json"), JSON.stringify(data), { mode: 0o600, flag: "wx" });
    symlinkSync("target.json", file);
    assert.throws(() => readAllowlistPreseed(file, env), { code: "ELOOP" });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

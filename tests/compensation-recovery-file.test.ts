import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  MAX_COMPENSATION_RECOVERY_APPROVAL_BYTES,
  readSignedCompensationRecoveryApprovalFile,
} from "../scripts/read-compensation-recovery-approval";

function inScratch(testCase: (dir: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "payrollph-recovery-approval-"));
  try { testCase(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("reads a bounded signed-approval JSON from its opened descriptor", () => {
  inScratch((dir) => {
    const path = join(dir, "approval.json");
    const value = { version: 1, purpose: "compensation-preledger-retry-v1", ticketId: "REVIEW-42" };
    writeFileSync(path, JSON.stringify(value));
    assert.deepEqual(readSignedCompensationRecoveryApprovalFile(path), value);
  });
});

test("rejects oversized approval without reading beyond the bounded buffer", () => {
  inScratch((dir) => {
    const path = join(dir, "oversize.json");
    writeFileSync(path, JSON.stringify({ filler: "x".repeat(MAX_COMPENSATION_RECOVERY_APPROVAL_BYTES) }));
    assert.throws(() => readSignedCompensationRecoveryApprovalFile(path), /size limit/);
  });
});

test("rejects empty and non-JSON approval files", () => {
  inScratch((dir) => {
    const path = join(dir, "empty.json");
    writeFileSync(path, "");
    assert.throws(() => readSignedCompensationRecoveryApprovalFile(path), /missing/);
    writeFileSync(path, "not-json");
    assert.throws(() => readSignedCompensationRecoveryApprovalFile(path), SyntaxError);
  });
});

test("rejects final-component symlinks and directories", () => {
  inScratch((dir) => {
    const source = join(dir, "source.json");
    const link = join(dir, "link.json");
    writeFileSync(source, "{}");
    symlinkSync(source, link);
    assert.throws(() => readSignedCompensationRecoveryApprovalFile(link));
    assert.throws(() => readSignedCompensationRecoveryApprovalFile(dir), /regular file/);
  });
});

test("the privileged CLI never performs separate pathname size and content reads", async () => {
  const { readFileSync } = await import("node:fs");
  const cli = readFileSync("scripts/recover-compensation-automation-intent.ts", "utf8");
  const helper = readFileSync("scripts/read-compensation-recovery-approval.ts", "utf8");
  assert.ok(cli.includes("readSignedCompensationRecoveryApprovalFile(approvalFile)"));
  assert.ok(!cli.includes("statSync(approvalFile)"));
  assert.ok(!cli.includes("readFileSync(approvalFile)"));
  assert.ok(helper.includes("openSync(") && helper.includes("fstatSync(fd)") && helper.includes("readSync(fd,"));
});

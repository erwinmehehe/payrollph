/** Validate the exact four-edit HCM Studio recovery hardening over the historic source.
 * Old immutable method receipts are not rewritten, and this is no new proof credit.
 * The dedicated current-source fictional PG16 flows must still pass separately.
 */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";

export const HISTORIC_AUTOMATION_SHA = "288d27789e062803d68ea38fd41fa78ee155a1ee";
export const CURRENT_AUTOMATION_SHA = "ce2c8e8feee4554c85f7739b73f2fa0325b81306";
export const AUTOMATION_PATH = "src/lib/automation.ts";
const SCOPE_PATH = "src/lib/automation-recovery-scope.ts";
const SCOPE_SHA = "ff3dddff0e7ddea20a7be24792d84503a540202e";
const RECEIPT_PATH = "scripts/qa/tenant-studio-recovery-scope-local-receipt.json";
const RECEIPT_SHA = "b522cb5d4363e4436535bf757affbfd6c2103818";
const PROOF_PATH = "scripts/qa/tenant-studio-recovery-scope-http.mjs";
const PROOF_SHA = "5ed183ec0560ae4ccc53f56f4652a2d66d782e1e";
const CONTRACT_PATH = "scripts/qa/tenant-studio-recovery-scope-contract.mjs";
const CONTRACT_SHA = "9e22df692f39494356bcc5fe65e5267872f51adf";
const REVIEWED_EDITS = [
  [
    "import { lockAutomationRecoveryScope } from \"@/lib/automation-recovery-scope\";\n",
    ""
  ],
  [
    "    const execution = await lockAutomationRecoveryScope(tx, input.organizationId, input.executionId);\n",
    "    const [execution] = await tx.select().from(automationExecutions).where(and(\n      eq(automationExecutions.id, input.executionId),\n      eq(automationExecutions.organizationId, input.organizationId),\n    )).limit(1);\n    if (!execution) throw new Error(\"Automation execution not found.\");\n"
  ],
  [
    "  return withAutomationRetryTransaction(input.organizationId, input.executionId, async (tx) => {\n  const execution = await lockAutomationRecoveryScope(tx, input.organizationId, input.executionId);\n",
    "  const [execution] = await db.select().from(automationExecutions).where(and(\n    eq(automationExecutions.id, input.executionId),\n    eq(automationExecutions.organizationId, input.organizationId),\n  )).limit(1);\n  if (!execution) throw new Error(\"Automation execution not found.\");\n"
  ],
  [
    "  return advanceAutomationExecution(replay.id);\n  });\n}\n\nexport async function advanceAutomationExecution",
    "  return advanceAutomationExecution(replay.id);\n}\n\nexport async function advanceAutomationExecution"
  ]
];
const sha = input => {
  const bytes=Buffer.from(input);
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
};
export function verifyNarrowStudioAutomationSource(read=readFileSync) {
  const source=Buffer.from(read(AUTOMATION_PATH));
  const actual=sha(source);
  if (actual===HISTORIC_AUTOMATION_SHA) return {kind:"historical-unchanged",newCredits:0};
  assert.equal(actual,CURRENT_AUTOMATION_SHA,"Studio runtime changed again; renew method-specific proof");
  let historical=source.toString("utf8");
  for (const [now,old] of REVIEWED_EDITS) {
    assert.equal(historical.split(now).length-1,1,"Studio hardening diff changed; cannot borrow historical receipts");
    historical=historical.replace(now,old);
  }
  assert.equal(sha(Buffer.from(historical)),HISTORIC_AUTOMATION_SHA,
    "Studio hardening must reconstruct every byte of the historical source");
  for(const [path, expected] of [[SCOPE_PATH,SCOPE_SHA],[RECEIPT_PATH,RECEIPT_SHA],
    [PROOF_PATH,PROOF_SHA],[CONTRACT_PATH,CONTRACT_SHA]])
    assert.equal(sha(read(path)),expected,"Studio current-source proof input drift: "+path);
  const scope=String(read(SCOPE_PATH));
  for(const gate of [".for(\"update\")",".for(\"share\")",
    "eq(automationExecutions.organizationId, organizationId)",
    "eq(automationRules.organizationId, organizationId)",
    "eq(employees.organizationId, organizationId)"])
    assert.ok(scope.includes(gate),"Missing employer-locked stored recovery boundary: "+gate);
  const receipt=JSON.parse(String(read(RECEIPT_PATH)));
  assert.equal(receipt.label,"SOLO_VERIFIED_DEV_RECOVERY");
  assert.equal(receipt.sourceBlobs?.[AUTOMATION_PATH],CURRENT_AUTOMATION_SHA);
  assert.equal(receipt.sourceBlobs?.[SCOPE_PATH],SCOPE_SHA);
  assert.equal(receipt.proofBlobSha,PROOF_SHA);
  assert.equal(receipt.twoAttackers,true);
  assert.equal(receipt.higherIdVictim,true);
  assert.equal(receipt.realWorkerSessionEffects,true);
  assert.equal(receipt.unchangedVictim,true);
  assert.deepEqual([receipt.own,receipt.denials,receipt.discriminations,receipt.locks],[16,64,16,1]);
  assert.deepEqual([receipt.resolution?.own,receipt.resolution?.denials,receipt.resolution?.discriminations],[36,36,36]);
  assert.equal(receipt.resolution?.authoritativeSourcesUnchanged,true);
  assert.equal(receipt.providerCalls,0);
  assert.equal(receipt.methodCredits,0);
  assert.equal(receipt.productionAccepted,false);
  return {kind:"exact-narrowing-with-disposable-evidence",newCredits:0,independentAcceptance:false};
}

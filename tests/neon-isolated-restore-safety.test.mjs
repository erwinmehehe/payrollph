import assert from "node:assert/strict";
import { test } from "node:test";
import {
  planIsolatedNeonRestore,
  verifyIsolatedNeonRestore,
} from "../scripts/lib/neon-isolated-restore-safety.mjs";

const metadata = () => ({
  projectId: "sample-safe-project-123456",
  snapshot: {id:"snap-synthetic-backup-abc123",source_branch_id:"br-original-main-abc123"},
  original: {
    branchId:"br-original-main-abc123",
    endpointId:"ep-synthetic-primary-abc123",
    endpointHost:"ep-synthetic-primary-abc123.c-13.us-east-1.aws.neon.tech",
  },
  observedDefault: {
    id:"br-original-main-abc123",name:"main",default:true,
  },
  observedEndpoint: {
    id:"ep-synthetic-primary-abc123",
    branch_id:"br-original-main-abc123",
    host:"ep-synthetic-primary-abc123.c-13.us-east-1.aws.neon.tech",
  },
  restoreBranchName:"payrollph-restore-rehearsal-20261012-isolated",
});
const response = () => ({
  id:"br-isolated-restore-b7mzd0n2",
  name:"payrollph-restore-rehearsal-20261012-isolated",
  primary:false,default:false,
  restored_from:"snap-synthetic-backup-abc123",
});

test("always generate non-promoting, new-branch request without target_branch_id", () => {
  const plan=planIsolatedNeonRestore(metadata());
  assert.deepEqual(plan.request,{
    project_id:"sample-safe-project-123456",
    snapshot_id:"snap-synthetic-backup-abc123",
    name:"payrollph-restore-rehearsal-20261012-isolated",
    finalize:false,
  });
  assert.equal(Object.hasOwn(plan.request,"target_branch_id"),false);
  assert.equal(Object.isFrozen(plan.request),true);
  assert.equal(plan.releaseApproved,false);
  const proof=verifyIsolatedNeonRestore(plan,response(),
    metadata().observedDefault,metadata().observedEndpoint);
  assert.equal(proof.isolated,true);
  assert.equal(proof.releaseApproved,false);
  assert.equal(proof.rpoRtoVerified,false);
});

test("reject override attempts, including implicit/explicit finalize and target branch", () => {
  for(const patch of [
    {finalize:true},
    {finalize:false},
    {target_branch_id:"br-original-main-abc123"},
    {targetBranchId:"br-original-main-abc123"},
    {existingBranchId:"br-original-main-abc123"},
  ]) {
    assert.throws(()=>planIsolatedNeonRestore({...metadata(),...patch}),
      /NEON_RESTORE_UNREVIEWED_OVERRIDE/);
  }
});

test("reject stale source snapshot, default branch and production endpoint IDs", () => {
  const base=metadata();
  assert.throws(()=>planIsolatedNeonRestore({...base,
    snapshot:{...base.snapshot,source_branch_id:"br-other-branch-b7o30"}}),
  /NEON_RESTORE_SNAPSHOT_WRONG_SOURCE/);
  assert.throws(()=>planIsolatedNeonRestore({...base,
    observedDefault:{...base.observedDefault,id:"br-snapshot-swapped-b79"}}),
  /NEON_RESTORE_DEFAULT_BRANCH_MISMATCH/);
  assert.throws(()=>planIsolatedNeonRestore({...base,
    observedEndpoint:{...base.observedEndpoint,branch_id:"br-other-branch-b7o30"}}),
  /NEON_RESTORE_PRODUCTION_ENDPOINT_MISMATCH/);
});

test("reject special branch names and corrupted production metadata", () => {
  for(const name of ["main","production",
    "payrollph-restore-rehearsal-main-20261012",
    "payrollph-restore-rehearsal-production-20261012",
    "payrollph-restore-rehearsal-!"]) {
    assert.throws(()=>planIsolatedNeonRestore({...metadata(),
      restoreBranchName:name}),/NEON_RESTORE_RESERVED_DESTINATION_NAME/);
  }
  assert.throws(()=>planIsolatedNeonRestore({...metadata(),snapshot:{id:"fake"}}),
    /NEON_RESTORE_UNVERIFIED_IDENTITY/);
  assert.throws(()=>planIsolatedNeonRestore({...metadata(),original:{
    ...metadata().original,endpointHost:"https://untrusted.invalid"}}),
    /NEON_RESTORE_UNVERIFIED_IDENTITY/);
});

test("postflight rejects auto-promotion, renamed default, and rerouted production endpoint", () => {
  const m=metadata(),plan=planIsolatedNeonRestore(m);
  for(const restored of [
    {...response(),id:plan.original.branchId},
    {...response(),primary:true},
    {...response(),default:true},
    {...response(),restored_from:"snap-unknown-b7g2o4"},
  ]) assert.throws(()=>verifyIsolatedNeonRestore(plan,restored,
    m.observedDefault,m.observedEndpoint),/NEON_RESTORE_RESTORED_BRANCH_NOT_ISOLATED/);

  assert.throws(()=>verifyIsolatedNeonRestore(plan,response(),
    {...m.observedDefault,id:response().id},m.observedEndpoint),
    /NEON_RESTORE_DEFAULT_BRANCH_CHANGED/);
  assert.throws(()=>verifyIsolatedNeonRestore(plan,response(),
    m.observedDefault,{...m.observedEndpoint,branch_id:response().id}),
    /NEON_RESTORE_PRODUCTION_ENDPOINT_REPOINTED/);
  assert.throws(()=>verifyIsolatedNeonRestore(
    {...plan,request:{...plan.request,finalize:true}},response(),
    m.observedDefault,m.observedEndpoint),/NEON_RESTORE_UNSAFE_REQUEST/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  planIsolatedNeonRestore,
  verifyIsolatedNeonRestore,
} from "../scripts/lib/neon-isolated-restore-safety.mjs";

const metadata = () => ({
  projectId: "calm-wave-70219564",
  snapshot: {id:"snap-red-sound-b798wnli",source_branch_id:"br-lucky-sound-b79i56jw"},
  original: {
    branchId:"br-lucky-sound-b79i56jw",
    endpointId:"ep-cool-hat-b7e7gpoo",
    endpointHost:"ep-cool-hat-b7e7gpoo.c-13.us-east-1.aws.neon.tech",
  },
  observedDefault: {
    id:"br-lucky-sound-b79i56jw",name:"main",default:true,
  },
  observedEndpoint: {
    id:"ep-cool-hat-b7e7gpoo",
    branch_id:"br-lucky-sound-b79i56jw",
    host:"ep-cool-hat-b7e7gpoo.c-13.us-east-1.aws.neon.tech",
  },
  restoreBranchName:"payrollph-restore-rehearsal-20261012-isolated",
});
const response = () => ({
  id:"br-isolated-restore-b7mzd0n2",
  name:"payrollph-restore-rehearsal-20261012-isolated",
  primary:false,default:false,
  restored_from:"snap-red-sound-b798wnli",
});

test("always generate non-promoting, new-branch request without target_branch_id", () => {
  const plan=planIsolatedNeonRestore(metadata());
  assert.deepEqual(plan.request,{
    project_id:"calm-wave-70219564",
    snapshot_id:"snap-red-sound-b798wnli",
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
    {target_branch_id:"br-lucky-sound-b79i56jw"},
    {targetBranchId:"br-lucky-sound-b79i56jw"},
    {existingBranchId:"br-lucky-sound-b79i56jw"},
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

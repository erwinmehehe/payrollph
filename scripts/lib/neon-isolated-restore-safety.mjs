/**
 * P0-4 safety gate for an ISOLATED, NON-PROMOTING Neon snapshot rehearsal.
 *
 * This module has NO Neon credentials and NEVER invokes the Neon API.
 * It only creates a request that explicitly sets finalize:false, then
 * checks independent read-only metadata after the operator executes it.
 *
 * DO NOT use this module as permission to cut over the default branch.
 */
function refuse(code) { throw new Error("NEON_RESTORE_" + code); }
function id(value, prefix) {
  return typeof value === "string" &&
    new RegExp("^" + prefix + "[a-z0-9-]{5,}$").test(value);
}
function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    refuse("MISSING_METADATA");
  }
}
function keysExactly(input, allowed) {
  if (Object.keys(input).some(key => !allowed.includes(key))) {
    refuse("UNREVIEWED_OVERRIDE");
  }
}

/**
 * All properties come from separate, read-only Neon get_default_branch,
 * get_postgres_endpoint and list_snapshots calls. Branch NAMES are never
 * accepted as substitutes for IDs. Unknown settings, especially
 * target_branch_id and finalize, must not be accepted from callers.
 */
export function planIsolatedNeonRestore(input) {
  requireObject(input);
  keysExactly(input, [
    "projectId", "snapshot", "original", "observedDefault",
    "observedEndpoint", "restoreBranchName",
  ]);
  const { projectId, snapshot, original, observedDefault, observedEndpoint,
    restoreBranchName } = input;
  for (const obj of [snapshot, original, observedDefault, observedEndpoint]) {
    requireObject(obj);
  }
  if (typeof projectId !== "string" || !/^[a-z][a-z0-9-]{3,59}$/.test(projectId) ||
      !id(snapshot.id, "snap-") ||
      !id(original.branchId, "br-") ||
      !id(original.endpointId, "ep-") ||
      typeof original.endpointHost !== "string" ||
      !/^[a-z0-9.-]+\.neon\.tech$/.test(original.endpointHost)) {
    refuse("UNVERIFIED_IDENTITY");
  }
  if (snapshot.source_branch_id !== original.branchId) {
    refuse("SNAPSHOT_WRONG_SOURCE");
  }
  if (observedDefault.id !== original.branchId ||
      observedDefault.name !== "main" || observedDefault.default !== true) {
    refuse("DEFAULT_BRANCH_MISMATCH");
  }
  if (observedEndpoint.id !== original.endpointId ||
      observedEndpoint.branch_id !== original.branchId ||
      observedEndpoint.host !== original.endpointHost) {
    refuse("PRODUCTION_ENDPOINT_MISMATCH");
  }
  if (typeof restoreBranchName !== "string" ||
      !/^payrollph-restore-rehearsal-[a-z0-9-]{6,55}$/.test(restoreBranchName) ||
      /(?:^|-)main(?:-|$)|(?:^|-)production(?:-|$)/.test(restoreBranchName)) {
    refuse("RESERVED_DESTINATION_NAME");
  }
  const request = Object.freeze({
    project_id: projectId,
    snapshot_id: snapshot.id,
    name: restoreBranchName,
    finalize: false, // CRITICAL: Neon defaults to true for a new branch.
  });
  return Object.freeze({
    request,
    original: Object.freeze({
      branchId: original.branchId,
      endpointId: original.endpointId,
      endpointHost: original.endpointHost,
    }),
    sourceSnapshotId: snapshot.id,
    releaseApproved: false,
    cutoverApproved: false,
  });
}

/**
 * Inspect after restore without mutating data. The operator must fetch
 * fresh metadata, never re-use preflight snapshots. A successful isolation
 * assertion does not prove data recovery, SQL parity or RPO/RTO.
 */
export function verifyIsolatedNeonRestore(plan, observedRestored,
  observedDefault, observedEndpoint) {
  for (const obj of [plan, observedRestored, observedDefault, observedEndpoint]) {
    requireObject(obj);
  }
  if (plan.request?.finalize !== false ||
      Object.hasOwn(plan.request ?? {}, "target_branch_id")) {
    refuse("UNSAFE_REQUEST");
  }
  if (!id(observedRestored.id, "br-") ||
      observedRestored.id === plan.original.branchId ||
      observedRestored.name !== plan.request.name ||
      observedRestored.default === true || observedRestored.primary === true ||
      observedRestored.restored_from !== plan.sourceSnapshotId) {
    refuse("RESTORED_BRANCH_NOT_ISOLATED");
  }
  if (observedDefault.id !== plan.original.branchId ||
      observedDefault.name !== "main" || observedDefault.default !== true) {
    refuse("DEFAULT_BRANCH_CHANGED");
  }
  if (observedEndpoint.id !== plan.original.endpointId ||
      observedEndpoint.branch_id !== plan.original.branchId ||
      observedEndpoint.host !== plan.original.endpointHost) {
    refuse("PRODUCTION_ENDPOINT_REPOINTED");
  }
  return Object.freeze({
    isolated: true,
    restoredBranchId: observedRestored.id,
    originalBranchUnchanged: true,
    originalEndpointUnchanged: true,
    releaseApproved: false,
    rpoRtoVerified: false,
  });
}

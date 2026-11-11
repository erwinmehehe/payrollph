/**
 * Read-only navigation contract for the employer-scoped readiness endpoint.
 * An owned HTTP 200 is NOT launch approval: it must retain explicit blocked
 * pilot, independent-acceptance, and employer-only evidence. A genuine 503
 * must still fail closed with a visible no-launch-evidence fallback.
 */
const fail = detail => ({ ok: false, detail });

export function checkReadinessNavigationContract({ employerId, responses, pageText, alerts }) {
  if (!Number.isSafeInteger(employerId) || employerId <= 0 ||
      !Array.isArray(responses) || responses.length === 0) {
    return fail("Missing employer-scoped readiness API response");
  }
  const last = responses.at(-1);
  const url = (() => {
    try { return new URL(last.url); } catch { return null; }
  })();
  if (!url || url.pathname !== "/api/readiness/workspace" ||
      url.searchParams.getAll("organizationId").length !== 1 ||
      url.searchParams.get("organizationId") !== String(employerId)) {
    return fail("Readiness request is not bound to exactly one selected employer");
  }
  if (!last.cacheControl?.includes("no-store")) {
    return fail("Readiness response must never be cached");
  }
  const body = last.body;
  if (last.status === 503) {
    if (body?.code !== "WORKSPACE_READINESS_UNAVAILABLE" ||
        typeof body.error !== "string" ||
        !body.error.includes("No launch or pilot status has been verified.") ||
        !(alerts ?? []).some(value => value.includes("Workspace readiness unavailable.")) ||
        !pageText?.includes("Workspace readiness unavailable.")) {
      return fail("HTTP 503 requires explicit no-launch-evidence fallback");
    }
    return { ok: true, mode: "evidence-unavailable" };
  }
  if (last.status !== 200) {
    return fail("Readiness expected employer-only HTTP 200 or fail-closed HTTP 503; got " + last.status);
  }
  const gates = body?.gates;
  if (!body || body.organizationId !== employerId ||
      body.status !== "not-launch-ready" || body.manualLaunch?.ready !== false ||
      typeof body.manualLaunch?.summary !== "string" ||
      !body.manualLaunch.summary.includes("not been verified") ||
      body.evidence?.scope !== "employer-only" ||
      !Number.isSafeInteger(body.evidence?.employeeRecords) ||
      !Number.isSafeInteger(body.evidence?.payrollRunRecords) ||
      !Number.isSafeInteger(body.evidence?.employeesWithoutRestDay) ||
      [body.evidence.employeeRecords, body.evidence.payrollRunRecords,
        body.evidence.employeesWithoutRestDay].some(n => n < 0) ||
      !Array.isArray(gates) || gates.length === 0 ||
      !gates.some(g => g.key === "external-pilot-acceptance" &&
        g.blocks === "launch" && g.ready === false) ||
      !gates.some(g => g.key === "operational-scale-evidence" &&
        g.blocks === "scale" && g.ready === false) ||
      !Number.isSafeInteger(body.launchBlockersRemaining) ||
      body.launchBlockersRemaining < 1 ||
      body.launchBlockersRemaining !== gates.filter(g => g.blocks === "launch" && !g.ready).length ||
      body.scaleGapsRemaining !== gates.filter(g => g.blocks === "scale" && !g.ready).length) {
    return fail("HTTP 200 must contain employer-bound, not-launch-ready, blocked-pilot proof");
  }
  if (!last.cacheControl.includes("private") ||
      !pageText?.includes("Not launch-ready yet.") ||
      !pageText.includes("MANUAL PILOT") ||
      !pageText.includes("Blocked") ||
      (alerts ?? []).some(text => text.includes("Workspace readiness unavailable."))) {
    return fail("Readiness screen must visibly show blocked launch and manual pilot");
  }
  return { ok: true, mode: "owned-not-launch-ready" };
}

export type VerifiedLaunchGate = {
  key: string; label: string; ready: boolean; detail: string;
  blocks: "launch" | "scale" | "none"; manualWorkaround: string | null;
};
export type VerifiedLaunchReadiness = {
  organizationId: number;
  status: "launch-ready" | "not-launch-ready";
  launchBlockersRemaining: number; scaleGapsRemaining: number;
  summary: string; manualLaunch: { ready: boolean; summary: string };
  generatedAt: string; gates: VerifiedLaunchGate[];
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === "string";
function validGate(value: unknown): value is VerifiedLaunchGate {
  return record(value) && text(value.key) && text(value.label) &&
    typeof value.ready === "boolean" && text(value.detail) &&
    ["launch", "scale", "none"].includes(String(value.blocks)) &&
    (value.manualWorkaround === null || text(value.manualWorkaround));
}
/** Only a signed-in, employer-matching complete source can display a green launch gate. */
export function readVerifiedLaunchReadiness(
  ok: boolean, value: unknown, employerId: number,
): VerifiedLaunchReadiness | null {
  if (!ok || !count(employerId) || employerId === 0 || !record(value) ||
      value.organizationId !== employerId ||
      !["launch-ready", "not-launch-ready"].includes(String(value.status)) ||
      !count(value.launchBlockersRemaining) || !count(value.scaleGapsRemaining) ||
      !text(value.summary) || !record(value.manualLaunch) ||
      typeof value.manualLaunch.ready !== "boolean" ||
      !text(value.manualLaunch.summary) || !text(value.generatedAt) ||
      !Array.isArray(value.gates) || value.gates.length === 0 ||
      !value.gates.every(validGate)) return null;
  const gates = value.gates as VerifiedLaunchGate[];
  // An empty or scale-only list cannot certify launch readiness.
  if (!gates.some((gate) => gate.blocks === "launch")) return null;
  if (new Set(gates.map((gate) => gate.key)).size !== gates.length) return null;
  const blockers = gates.filter((gate) => gate.blocks === "launch" && !gate.ready).length;
  const gaps = gates.filter((gate) => gate.blocks === "scale" && !gate.ready).length;
  if (value.launchBlockersRemaining !== blockers || value.scaleGapsRemaining !== gaps ||
      (value.status === "launch-ready") !== (blockers === 0)) return null;
  return value as VerifiedLaunchReadiness;
}
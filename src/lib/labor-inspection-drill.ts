import { createHash } from "node:crypto";

export type InspectionDrillStatus = "blocked" | "needs-work" | "evidence-ready";

export type InspectionDrillInput = {
  evidencePackSha256: string;
  schemaVersion: string;
  rangeLabel: string;
  findings: Array<{
    key: string;
    ruleCode: string;
    category: string;
    severity: "high" | "medium" | "info";
    title: string;
    employeeNo?: string | null;
    periodLabel?: string | null;
    exposureAmount: number | null;
    exposureConfidence: "recorded-liability" | "screening-estimate" | null;
    remediation?: { owner?: string | null; status?: string | null } | null;
    defaultOwner: string;
  }>;
  readyToCloseCount: number;
  sectionRowCounts: Record<string, number>;
};

export type InspectionDrillResult = {
  status: InspectionDrillStatus;
  summary: {
    high: number;
    medium: number;
    info: number;
    recordedExposure: number;
    screeningExposure: number;
    unownedActionable: number;
    readyToClose: number;
  };
  blockers: Array<{
    key: string;
    ruleCode: string;
    category: string;
    title: string;
    employeeNo: string | null;
    periodLabel: string | null;
    owner: string;
    exposureAmount: number | null;
    exposureConfidence: "recorded-liability" | "screening-estimate" | null;
  }>;
  actionPlan: Array<{
    priority: "P0" | "P1" | "P2";
    owner: string;
    findingKey: string;
    ruleCode: string;
    title: string;
  }>;
  evidencePackSha256: string;
  evidencePackVersion: string;
  rangeLabel: string;
  sectionRowCounts: Record<string, number>;
  snapshotSha256: string;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function buildInspectionDrill(input: InspectionDrillInput): InspectionDrillResult {
  const high = input.findings.filter((finding) => finding.severity === "high").length;
  const medium = input.findings.filter((finding) => finding.severity === "medium").length;
  const info = input.findings.filter((finding) => finding.severity === "info").length;
  const actionable = input.findings.filter((finding) => finding.severity !== "info");
  const blockers = actionable.map((finding) => ({
    key: finding.key,
    ruleCode: finding.ruleCode,
    category: finding.category,
    title: finding.title,
    employeeNo: finding.employeeNo ?? null,
    periodLabel: finding.periodLabel ?? null,
    owner: finding.remediation?.owner?.trim() || finding.defaultOwner,
    exposureAmount: finding.exposureAmount,
    exposureConfidence: finding.exposureConfidence,
  }));

  const recordedExposure = round2(input.findings.reduce(
    (sum, finding) => sum + (finding.exposureConfidence === "recorded-liability" ? finding.exposureAmount ?? 0 : 0),
    0,
  ));
  const screeningExposure = round2(input.findings.reduce(
    (sum, finding) => sum + (finding.exposureConfidence === "screening-estimate" ? finding.exposureAmount ?? 0 : 0),
    0,
  ));
  const unownedActionable = actionable.filter((finding) => !finding.remediation?.owner?.trim()).length;

  const status: InspectionDrillStatus =
    high > 0
      ? "blocked"
      : medium > 0 || input.readyToCloseCount > 0
        ? "needs-work"
        : "evidence-ready";

  const priorityRank = { P0: 0, P1: 1, P2: 2 } as const;
  const actionPlan = input.findings
    .map((finding) => ({
      priority: (finding.severity === "high" ? "P0" : finding.severity === "medium" ? "P1" : "P2") as "P0" | "P1" | "P2",
      owner: finding.remediation?.owner?.trim() || finding.defaultOwner,
      findingKey: finding.key,
      ruleCode: finding.ruleCode,
      title: finding.title,
    }))
    .sort((a, b) =>
      priorityRank[a.priority] - priorityRank[b.priority]
      || a.owner.localeCompare(b.owner)
      || a.findingKey.localeCompare(b.findingKey)
    );

  const canonical = {
    status,
    summary: {
      high,
      medium,
      info,
      recordedExposure,
      screeningExposure,
      unownedActionable,
      readyToClose: input.readyToCloseCount,
    },
    blockers,
    actionPlan,
    evidencePackSha256: input.evidencePackSha256,
    evidencePackVersion: input.schemaVersion,
    rangeLabel: input.rangeLabel,
    sectionRowCounts: input.sectionRowCounts,
  };

  const snapshotSha256 = createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");

  return { ...canonical, snapshotSha256 };
}

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  hcmDocumentRequirements,
  hcmEmployeeDocumentCompliance,
  hcmEmployeeSkills,
  hcmSkills,
  jobProfiles,
  orgUnits,
  positionAssignments,
  positions,
} from "@/db/schema";

export type WorkerAttributeContext = {
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  employeeEmail: string | null;
  employeeStatus: string;
  employeeStartDate: string;
  orgUnitId: number | null;
  department: string | null;
  location: string;
  employmentType: string;
  title: string;
  role: string;
  salary: number;
  legalEntityId: number | null;
  tenureDays: number;
  tenureYears: number;
  positionId: number | null;
  positionCode: string | null;
  jobProfileId: number | null;
  jobFamily: string | null;
  jobLevel: string | null;
  grade: string | null;
  managerEmployeeId: number | null;
  managerName: string | null;
  managerEmail: string | null;
  verifiedSkillCodes: string[];
  validCredentialCodes: string[];
};

function todayPh() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function activeDateRange(
  from: Date | string,
  until: Date | string | null,
  date: string,
) {
  const fromText = String(from).slice(0, 10);
  const untilText = until == null ? null : String(until).slice(0, 10);
  return fromText <= date && (untilText == null || untilText >= date);
}

function credentialPasses(
  row: {
    status: string;
    expiresAt: Date | string | null;
    waivedAt: Date | string | null;
  },
  date: string,
) {
  if (row.waivedAt || row.status === "waived") return true;
  if (!["current", "expiring"].includes(row.status)) return false;
  return row.expiresAt == null || String(row.expiresAt).slice(0, 10) >= date;
}

export async function loadWorkerAttributeContexts(input: {
  organizationId: number;
  employeeIds?: number[];
  asOfDate?: string;
}): Promise<WorkerAttributeContext[]> {
  const requestedIds = input.employeeIds == null
    ? null
    : [...new Set(input.employeeIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (requestedIds && requestedIds.length === 0) return [];

  const employeeWhere = requestedIds
    ? and(
        eq(employees.organizationId, input.organizationId),
        inArray(employees.id, requestedIds),
      )
    : eq(employees.organizationId, input.organizationId);
  const employeeRows = await db.select().from(employees).where(employeeWhere);
  if (!employeeRows.length) return [];

  const employeeIds = employeeRows.map((row) => row.id);
  const assignmentRows = await db.select().from(positionAssignments).where(and(
    eq(positionAssignments.organizationId, input.organizationId),
    inArray(positionAssignments.employeeId, employeeIds),
    eq(positionAssignments.assignmentType, "primary"),
    isNull(positionAssignments.effectiveUntil),
  ));
  const positionIds = [...new Set(assignmentRows.map((row) => row.positionId))];
  const positionRows = positionIds.length
    ? await db.select().from(positions).where(and(
        eq(positions.organizationId, input.organizationId),
        inArray(positions.id, positionIds),
      ))
    : [];

  const orgUnitIds = [...new Set(employeeRows.flatMap((row) => row.orgUnitId ? [row.orgUnitId] : []))];
  const profileIds = [...new Set(positionRows.map((row) => row.jobProfileId))];
  const managerIds = [...new Set(positionRows.flatMap((row) => row.managerEmployeeId ? [row.managerEmployeeId] : []))];

  const [unitRows, profileRows, managerRows, employeeSkillRows, complianceRows] = await Promise.all([
    orgUnitIds.length
      ? db.select({ id: orgUnits.id, name: orgUnits.name }).from(orgUnits).where(and(
          eq(orgUnits.organizationId, input.organizationId),
          inArray(orgUnits.id, orgUnitIds),
        ))
      : Promise.resolve([]),
    profileIds.length
      ? db.select({
          id: jobProfiles.id,
          title: jobProfiles.title,
          family: jobProfiles.family,
          level: jobProfiles.level,
          grade: jobProfiles.grade,
        }).from(jobProfiles).where(and(
          eq(jobProfiles.organizationId, input.organizationId),
          inArray(jobProfiles.id, profileIds),
        ))
      : Promise.resolve([]),
    managerIds.length
      ? db.select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          email: employees.email,
        }).from(employees).where(and(
          eq(employees.organizationId, input.organizationId),
          inArray(employees.id, managerIds),
        ))
      : Promise.resolve([]),
    db.select({
      employeeId: hcmEmployeeSkills.employeeId,
      skillId: hcmEmployeeSkills.skillId,
      status: hcmEmployeeSkills.status,
      effectiveFrom: hcmEmployeeSkills.effectiveFrom,
      effectiveUntil: hcmEmployeeSkills.effectiveUntil,
    }).from(hcmEmployeeSkills).where(and(
      eq(hcmEmployeeSkills.organizationId, input.organizationId),
      inArray(hcmEmployeeSkills.employeeId, employeeIds),
    )),
    db.select({
      employeeId: hcmEmployeeDocumentCompliance.employeeId,
      requirementId: hcmEmployeeDocumentCompliance.requirementId,
      status: hcmEmployeeDocumentCompliance.status,
      expiresAt: hcmEmployeeDocumentCompliance.expiresAt,
      waivedAt: hcmEmployeeDocumentCompliance.waivedAt,
    }).from(hcmEmployeeDocumentCompliance).where(and(
      eq(hcmEmployeeDocumentCompliance.organizationId, input.organizationId),
      inArray(hcmEmployeeDocumentCompliance.employeeId, employeeIds),
    )),
  ]);

  const skillIds = [...new Set(employeeSkillRows.map((row) => row.skillId))];
  const requirementIds = [...new Set(complianceRows.map((row) => row.requirementId))];
  const [skillRows, requirementRows] = await Promise.all([
    skillIds.length
      ? db.select({
          id: hcmSkills.id,
          code: hcmSkills.code,
          active: hcmSkills.active,
        }).from(hcmSkills).where(and(
          eq(hcmSkills.organizationId, input.organizationId),
          inArray(hcmSkills.id, skillIds),
        ))
      : Promise.resolve([]),
    requirementIds.length
      ? db.select({
          id: hcmDocumentRequirements.id,
          code: hcmDocumentRequirements.code,
          active: hcmDocumentRequirements.active,
        }).from(hcmDocumentRequirements).where(and(
          eq(hcmDocumentRequirements.organizationId, input.organizationId),
          inArray(hcmDocumentRequirements.id, requirementIds),
        ))
      : Promise.resolve([]),
  ]);

  const assignmentByEmployee = new Map(assignmentRows.map((row) => [row.employeeId, row]));
  const positionById = new Map(positionRows.map((row) => [row.id, row]));
  const unitById = new Map(unitRows.map((row) => [row.id, row]));
  const profileById = new Map(profileRows.map((row) => [row.id, row]));
  const managerById = new Map(managerRows.map((row) => [row.id, row]));
  const skillById = new Map(skillRows.map((row) => [row.id, row]));
  const requirementById = new Map(requirementRows.map((row) => [row.id, row]));
  const asOfDate = input.asOfDate ?? todayPh();

  const skillCodesByEmployee = new Map<number, Set<string>>();
  for (const row of employeeSkillRows) {
    const skill = skillById.get(row.skillId);
    if (
      !skill?.active
      || row.status !== "verified"
      || !activeDateRange(row.effectiveFrom, row.effectiveUntil, asOfDate)
    ) continue;
    const set = skillCodesByEmployee.get(row.employeeId) ?? new Set<string>();
    set.add(skill.code);
    skillCodesByEmployee.set(row.employeeId, set);
  }

  const credentialCodesByEmployee = new Map<number, Set<string>>();
  for (const row of complianceRows) {
    const requirement = requirementById.get(row.requirementId);
    if (!requirement?.active || !credentialPasses(row, asOfDate)) continue;
    const set = credentialCodesByEmployee.get(row.employeeId) ?? new Set<string>();
    set.add(requirement.code);
    credentialCodesByEmployee.set(row.employeeId, set);
  }

  const asOf = Date.parse(`${asOfDate}T00:00:00Z`);

  return employeeRows.map((employee) => {
    const assignment = assignmentByEmployee.get(employee.id) ?? null;
    const position = assignment ? positionById.get(assignment.positionId) ?? null : null;
    const profile = position ? profileById.get(position.jobProfileId) ?? null : null;
    const manager = position?.managerEmployeeId
      ? managerById.get(position.managerEmployeeId) ?? null
      : null;
    const start = Date.parse(`${String(employee.startDate)}T00:00:00Z`);
    const tenureDays = Number.isFinite(start) && Number.isFinite(asOf)
      ? Math.max(0, Math.floor((asOf - start) / 86_400_000))
      : 0;

    return {
      employeeId: employee.id,
      employeeNo: employee.employeeNo,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeEmail: employee.email,
      employeeStatus: employee.status,
      employeeStartDate: String(employee.startDate),
      orgUnitId: employee.orgUnitId,
      department: employee.orgUnitId ? unitById.get(employee.orgUnitId)?.name ?? null : null,
      location: employee.region,
      employmentType: employee.employmentType,
      title: employee.title,
      role: profile?.title ?? employee.title,
      salary: Number(employee.basicRate),
      legalEntityId: employee.legalEntityId,
      tenureDays,
      tenureYears: Math.round((tenureDays / 365.25) * 100) / 100,
      positionId: position?.id ?? null,
      positionCode: position?.code ?? null,
      jobProfileId: profile?.id ?? null,
      jobFamily: profile?.family ?? null,
      jobLevel: profile?.level ?? null,
      grade: profile?.grade ?? null,
      managerEmployeeId: manager?.id ?? null,
      managerName: manager ? `${manager.firstName} ${manager.lastName}` : null,
      managerEmail: manager?.email ?? null,
      verifiedSkillCodes: [...(skillCodesByEmployee.get(employee.id) ?? [])].sort(),
      validCredentialCodes: [...(credentialCodesByEmployee.get(employee.id) ?? [])].sort(),
    };
  });
}

export async function loadWorkerAttributeContext(input: {
  organizationId: number;
  employeeId: number;
  asOfDate?: string;
}) {
  const rows = await loadWorkerAttributeContexts({
    organizationId: input.organizationId,
    employeeIds: [input.employeeId],
    asOfDate: input.asOfDate,
  });
  return rows[0] ?? null;
}

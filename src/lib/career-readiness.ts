export type CareerRequirement = {
  jobProfileId: number;
  skillId: number;
  requiredLevel: number;
  critical: boolean;
};

export type CareerSkillEvidence = {
  employeeId: number;
  skillId: number;
  proficiencyLevel: number;
};

export type CareerAssignment = {
  employeeId: number;
  positionId: number;
};

export type CareerPosition = {
  id: number;
  jobProfileId: number;
};

export type CareerProfile = {
  id: number;
};

export type CareerEmployee = {
  id: number;
};

export type CareerReadinessRow = {
  employeeId: number;
  currentJobProfileId: number | null;
  targetJobProfileId: number;
  metRequirements: number;
  totalRequirements: number;
  criticalGaps: Array<{ skillId: number; requiredLevel: number; currentLevel: number }>;
  readinessPercent: number;
};

export function calculateCareerReadiness(input: {
  employees: CareerEmployee[];
  assignments: CareerAssignment[];
  positions: CareerPosition[];
  profiles: CareerProfile[];
  requirements: CareerRequirement[];
  skills: CareerSkillEvidence[];
}) {
  const positionById = new Map(input.positions.map((position) => [position.id, position]));
  const assignmentByEmployee = new Map(input.assignments.map((assignment) => [assignment.employeeId, assignment]));
  const skillsByEmployee = new Map<number, CareerSkillEvidence[]>();
  for (const row of input.skills) {
    skillsByEmployee.set(row.employeeId, [...(skillsByEmployee.get(row.employeeId) ?? []), row]);
  }
  const requirementsByProfile = new Map<number, CareerRequirement[]>();
  for (const row of input.requirements) {
    requirementsByProfile.set(row.jobProfileId, [...(requirementsByProfile.get(row.jobProfileId) ?? []), row]);
  }

  const rows: CareerReadinessRow[] = [];
  for (const employee of input.employees) {
    const assignment = assignmentByEmployee.get(employee.id);
    const currentPosition = assignment ? positionById.get(assignment.positionId) ?? null : null;
    const currentJobProfileId = currentPosition?.jobProfileId ?? null;
    const proficiency = new Map((skillsByEmployee.get(employee.id) ?? []).map((row) => [row.skillId, row.proficiencyLevel]));

    for (const target of input.profiles) {
      if (target.id === currentJobProfileId) continue;
      const reqs = requirementsByProfile.get(target.id) ?? [];
      if (!reqs.length) continue;

      let points = 0;
      let possible = 0;
      let metRequirements = 0;
      const criticalGaps: CareerReadinessRow["criticalGaps"] = [];

      for (const req of reqs) {
        const currentLevel = proficiency.get(req.skillId) ?? 0;
        const weight = req.critical ? 2 : 1;
        possible += weight;
        points += Math.min(currentLevel / req.requiredLevel, 1) * weight;
        if (currentLevel >= req.requiredLevel) metRequirements += 1;
        if (req.critical && currentLevel < req.requiredLevel) {
          criticalGaps.push({ skillId: req.skillId, requiredLevel: req.requiredLevel, currentLevel });
        }
      }

      rows.push({
        employeeId: employee.id,
        currentJobProfileId,
        targetJobProfileId: target.id,
        metRequirements,
        totalRequirements: reqs.length,
        criticalGaps,
        readinessPercent: possible > 0 ? Math.round((points / possible) * 100) : 0,
      });
    }
  }

  return rows;
}

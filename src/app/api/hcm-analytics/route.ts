import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  benefitEnrollments,
  benefitPlans,
  compensationBands,
  compensationCycles,
  compensationRecommendations,
  employeePayProfiles,
  employeeSkills,
  employees,
  engagementAnswers,
  engagementQuestions,
  engagementResponses,
  engagementSurveys,
  jobApplicants,
  jobProfileSkills,
  jobProfiles,
  jobRequisitions,
  orgUnits,
  payrollEntries,
  payrollRuns,
  performanceCycles,
  performanceReviews,
  positionAssignments,
  positions,
  separationRecords,
  workforcePlans,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { calculateCareerReadiness } from "@/lib/career-readiness";
import {
  HCM_ANALYTICS_PRIVACY_THRESHOLD,
  averageNumber,
  daysBetween,
  medianNumber,
  percent,
  performanceDistribution,
  phToday,
  reconstructHeadcountTrend,
  recruitingFunnel,
  reportableSensitiveCohort,
  traceInputNumber,
} from "@/lib/hcm-analytics";
import { average as engagementAverage, enpsSummary, normalizedPrivacyThreshold, reportableCohort } from "@/lib/engagement-privacy";

export const dynamic = "force-dynamic";

function yearStart(today: string) {
  return today.slice(0, 4) + "-01-01";
}

function inRange(value: string, start: string, end: string) {
  return value >= start && value <= end;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function cycleLabel(cycle: { name: string; startDate: string; endDate: string }) {
  return cycle.name || cycle.startDate + " – " + cycle.endDate;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Your role is not allowed to view advanced HCM analytics.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  if (access.role === "bookkeeper") {
    return Response.json({ error: "Bookkeeper access does not include talent and employee-listening analytics." }, { status: 403 });
  }

  const today = phToday();
  const ytdStart = yearStart(today);

  const [
    staff,
    units,
    separations,
    requisitions,
    applicants,
    positionRows,
    assignments,
    profileRows,
    requirements,
    skillRows,
    reviewRows,
    performanceCycleRows,
    payProfiles,
    bands,
    compensationCycleRows,
    recommendations,
    entryRows,
    benefitPlanRows,
    benefitEnrollmentRows,
    planRows,
    surveyRows,
    questionRows,
    responseRows,
    answerRows,
  ] = await Promise.all([
    db.select().from(employees).where(eq(employees.organizationId, organizationId)),
    db.select().from(orgUnits).where(eq(orgUnits.organizationId, organizationId)),
    db.select().from(separationRecords).where(eq(separationRecords.organizationId, organizationId)),
    db.select().from(jobRequisitions).where(eq(jobRequisitions.organizationId, organizationId)).orderBy(desc(jobRequisitions.id)),
    db.select().from(jobApplicants).where(eq(jobApplicants.organizationId, organizationId)),
    db.select().from(positions).where(eq(positions.organizationId, organizationId)),
    db.select().from(positionAssignments).where(and(eq(positionAssignments.organizationId, organizationId), isNull(positionAssignments.effectiveUntil))),
    db.select().from(jobProfiles).where(and(eq(jobProfiles.organizationId, organizationId), eq(jobProfiles.active, true))),
    db.select().from(jobProfileSkills).where(eq(jobProfileSkills.organizationId, organizationId)),
    db.select().from(employeeSkills).where(eq(employeeSkills.organizationId, organizationId)),
    db.select().from(performanceReviews).where(eq(performanceReviews.organizationId, organizationId)),
    db.select().from(performanceCycles).where(eq(performanceCycles.organizationId, organizationId)).orderBy(desc(performanceCycles.endDate)),
    db.select().from(employeePayProfiles).where(eq(employeePayProfiles.organizationId, organizationId)),
    db.select().from(compensationBands).where(and(eq(compensationBands.organizationId, organizationId), eq(compensationBands.active, true))),
    db.select().from(compensationCycles).where(eq(compensationCycles.organizationId, organizationId)).orderBy(desc(compensationCycles.effectiveDate)),
    db.select().from(compensationRecommendations).where(eq(compensationRecommendations.organizationId, organizationId)),
    db.select({
      employeeId: payrollEntries.employeeId,
      grossPay: payrollEntries.grossPay,
      netPay: payrollEntries.netPay,
      trace: payrollEntries.trace,
      runStatus: payrollRuns.status,
      payDate: payrollRuns.payDate,
    }).from(payrollEntries)
      .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
      .where(eq(payrollRuns.organizationId, organizationId)),
    db.select().from(benefitPlans).where(eq(benefitPlans.organizationId, organizationId)),
    db.select().from(benefitEnrollments).where(eq(benefitEnrollments.organizationId, organizationId)),
    db.select().from(workforcePlans).where(eq(workforcePlans.organizationId, organizationId)).orderBy(desc(workforcePlans.startDate)),
    db.select().from(engagementSurveys).where(eq(engagementSurveys.organizationId, organizationId)).orderBy(desc(engagementSurveys.id)),
    db.select().from(engagementQuestions).where(eq(engagementQuestions.organizationId, organizationId)),
    db.select().from(engagementResponses).where(eq(engagementResponses.organizationId, organizationId)),
    db.select().from(engagementAnswers).where(eq(engagementAnswers.organizationId, organizationId)),
  ]);

  const visibleEmployees = access.companyWide
    ? staff
    : staff.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleEmployeeIds = new Set(visibleEmployees.map((employee) => employee.id));
  const activeEmployees = visibleEmployees.filter((employee) => employee.status === "Active");

  const visibleSeparations = separations.filter((row) => visibleEmployeeIds.has(row.employeeId));
  const releasedSeparations = visibleSeparations.filter((row) => row.status === "released");
  const hiresYtd = visibleEmployees.filter((employee) => inRange(employee.startDate, ytdStart, today)).length;
  const separationsYtd = releasedSeparations.filter((row) => inRange(row.lastDay, ytdStart, today)).length;

  const headcountTrend = reconstructHeadcountTrend({
    today,
    employees: visibleEmployees.map((employee) => ({ id: employee.id, startDate: employee.startDate })),
    separations: visibleSeparations.map((row) => ({ employeeId: row.employeeId, lastDay: row.lastDay, status: row.status })),
    months: 12,
  });
  const currentHeadcount = headcountTrend.at(-1)?.headcount ?? activeEmployees.length;
  const openingDate = String(Number(today.slice(0, 4)) - 1) + "-12-31";
  const openingHeadcount = reconstructHeadcountTrend({
    today: openingDate,
    employees: visibleEmployees.map((employee) => ({ id: employee.id, startDate: employee.startDate })),
    separations: visibleSeparations.map((row) => ({ employeeId: row.employeeId, lastDay: row.lastDay, status: row.status })),
    months: 1,
  })[0]?.headcount ?? currentHeadcount;
  const averageHeadcount = (openingHeadcount + currentHeadcount) / 2;
  const turnoverRateYtd = averageHeadcount > 0 ? percent(separationsYtd, averageHeadcount) : 0;

  const visibleRequisitions = requisitions.filter((row) =>
    access.companyWide || row.orgUnitId === access.orgUnitId
  );
  const visibleRequisitionIds = new Set(visibleRequisitions.map((row) => row.id));
  const visibleApplicants = applicants.filter((row) => visibleRequisitionIds.has(row.requisitionId));
  const reqById = new Map(visibleRequisitions.map((row) => [row.id, row]));
  const timeToFillDays = visibleApplicants
    .filter((applicant) => applicant.stage === "hired" && applicant.hiredAt)
    .map((applicant) => {
      const requisition = reqById.get(applicant.requisitionId);
      return requisition && applicant.hiredAt ? daysBetween(requisition.createdAt, applicant.hiredAt) : null;
    })
    .filter((value): value is number => value !== null);
  const funnel = recruitingFunnel(visibleApplicants.map((row) => row.stage));

  const visiblePositions = positionRows.filter((row) =>
    access.companyWide || row.orgUnitId === access.orgUnitId
  );
  const visiblePositionIds = new Set(visiblePositions.map((row) => row.id));
  const visibleAssignments = assignments.filter((row) =>
    visiblePositionIds.has(row.positionId) && visibleEmployeeIds.has(row.employeeId)
  );
  const positionStatus = ["planned", "approved", "open", "filled", "frozen", "closed"].map((status) => ({
    status,
    count: visiblePositions.filter((row) => row.status === status).length,
  }));
  const openPositions = visiblePositions.filter((row) => row.status === "open").length;
  const filledPositions = visiblePositions.filter((row) => row.status === "filled").length;
  const vacancyRate = percent(openPositions, openPositions + filledPositions);

  const employeeById = new Map(staff.map((employee) => [employee.id, employee]));
  const directReportsByManager = new Map<number, number>();
  for (const assignment of visibleAssignments) {
    const position = positionRows.find((candidate) => candidate.id === assignment.positionId);
    if (!position?.managerEmployeeId) continue;
    directReportsByManager.set(position.managerEmployeeId, (directReportsByManager.get(position.managerEmployeeId) ?? 0) + 1);
  }
  const spanRows = [...directReportsByManager.entries()]
    .map(([managerEmployeeId, directReports]) => {
      const manager = employeeById.get(managerEmployeeId);
      return {
        managerEmployeeId,
        managerName: manager ? manager.firstName + " " + manager.lastName : "Manager",
        directReports,
      };
    })
    .sort((a, b) => b.directReports - a.directReports);
  const averageSpan = averageNumber(spanRows.map((row) => row.directReports));

  const completedReviews = reviewRows.filter((row) =>
    visibleEmployeeIds.has(row.employeeId)
    && row.status === "completed"
    && (row.finalScore !== null || row.managerScore !== null)
  );
  const performanceScores = completedReviews
    .map((row) => Number(row.finalScore ?? row.managerScore))
    .filter((value) => Number.isFinite(value));
  const performanceReportable = reportableSensitiveCohort(performanceScores.length);
  const performanceCycles = performanceCycleRows.map((cycle) => {
    const cycleScores = completedReviews
      .filter((review) => review.cycleId === cycle.id)
      .map((review) => Number(review.finalScore ?? review.managerScore))
      .filter((value) => Number.isFinite(value));
    if (!reportableSensitiveCohort(cycleScores.length)) return null;
    return {
      cycleId: cycle.id,
      label: cycleLabel(cycle),
      responseCount: cycleScores.length,
      averageScore: Math.round((averageNumber(cycleScores) ?? 0) * 100) / 100,
      medianScore: Math.round((medianNumber(cycleScores) ?? 0) * 100) / 100,
    };
  }).filter((row): row is NonNullable<typeof row> => row !== null).slice(0, 8);

  const assignmentByEmployee = new Map(visibleAssignments.map((assignment) => [assignment.employeeId, assignment]));
  const positionById = new Map(positionRows.map((position) => [position.id, position]));
  const payByEmployee = new Map(payProfiles.map((profile) => [profile.employeeId, profile]));
  const monthlyCompRows = activeEmployees.flatMap((employee) => {
    const pay = payByEmployee.get(employee.id);
    if (!pay || pay.payBasis !== "monthly") return [];
    const assignment = assignmentByEmployee.get(employee.id);
    const position = assignment ? positionById.get(assignment.positionId) : null;
    if (!position) return [];
    const band = bands.find((candidate) =>
      candidate.jobProfileId === position.jobProfileId && candidate.orgUnitId === employee.orgUnitId
    ) ?? bands.find((candidate) =>
      candidate.jobProfileId === position.jobProfileId && candidate.orgUnitId === null
    );
    const rate = Number(pay.rateAmount);
    if (!Number.isFinite(rate)) return [];
    if (!band) return [{ employeeId: employee.id, rate, band: null, compaRatio: null }];
    const midpoint = Number(band.midpointMonthly);
    return [{
      employeeId: employee.id,
      rate,
      band,
      compaRatio: midpoint > 0 ? rate / midpoint : null,
    }];
  });
  const bandedCompRows = monthlyCompRows.filter((row) => row.band && row.compaRatio !== null);
  const compensationReportable = reportableSensitiveCohort(bandedCompRows.length);
  const rawBandBuckets = {
    below: bandedCompRows.filter((row) => row.band && row.rate < Number(row.band.minimumMonthly)).length,
    inBand: bandedCompRows.filter((row) => row.band && row.rate >= Number(row.band.minimumMonthly) && row.rate <= Number(row.band.maximumMonthly)).length,
    above: bandedCompRows.filter((row) => row.band && row.rate > Number(row.band.maximumMonthly)).length,
  };
  const safeBandDistribution = compensationReportable
    ? [
        { label: "Below band", count: rawBandBuckets.below },
        { label: "In band", count: rawBandBuckets.inBand },
        { label: "Above band", count: rawBandBuckets.above },
      ].map((bucket) => ({
        label: bucket.label,
        count: bucket.count >= HCM_ANALYTICS_PRIVACY_THRESHOLD ? bucket.count : null,
        suppressed: bucket.count > 0 && bucket.count < HCM_ANALYTICS_PRIVACY_THRESHOLD,
      }))
    : [];

  const latestCompensationCycle = compensationCycleRows[0] ?? null;
  const visibleRecommendations = recommendations.filter((row) => visibleEmployeeIds.has(row.employeeId));
  const committedAnnualizedIncrease = latestCompensationCycle
    ? visibleRecommendations
        .filter((row) => row.cycleId === latestCompensationCycle.id && ["submitted", "approved", "applied"].includes(row.status))
        .reduce((sum, row) => sum + Number(row.annualizedIncrease), 0)
    : 0;

  const careerReadiness = calculateCareerReadiness({
    employees: activeEmployees,
    assignments: visibleAssignments,
    positions: visiblePositions,
    profiles: profileRows,
    requirements,
    skills: skillRows.filter((row) => visibleEmployeeIds.has(row.employeeId)),
  });
  const bestReadinessByEmployee = new Map<number, typeof careerReadiness[number]>();
  for (const row of careerReadiness) {
    const current = bestReadinessByEmployee.get(row.employeeId);
    if (!current || row.readinessPercent > current.readinessPercent) bestReadinessByEmployee.set(row.employeeId, row);
  }
  const readinessRows = [...bestReadinessByEmployee.values()];
  const mobilityReportable = reportableSensitiveCohort(readinessRows.length);
  const readyRows = readinessRows.filter((row) => row.readinessPercent >= 80 && row.criticalGaps.length === 0);
  const targetProfileCounts = new Map<number, number>();
  for (const row of readyRows) {
    targetProfileCounts.set(row.targetJobProfileId, (targetProfileCounts.get(row.targetJobProfileId) ?? 0) + 1);
  }
  const profileById = new Map(profileRows.map((profile) => [profile.id, profile]));
  const safeTargetProfiles = mobilityReportable
    ? [...targetProfileCounts.entries()]
        .filter(([, count]) => count >= HCM_ANALYTICS_PRIVACY_THRESHOLD)
        .map(([jobProfileId, count]) => ({
          jobProfileId,
          title: profileById.get(jobProfileId)?.title ?? "Job profile",
          count,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
    : [];
  const skillEvidenceEmployees = new Set(skillRows.filter((row) => visibleEmployeeIds.has(row.employeeId)).map((row) => row.employeeId));

  const visibleEntryRows = entryRows.filter((row) =>
    visibleEmployeeIds.has(row.employeeId)
    && row.runStatus === "Released"
    && inRange(row.payDate, ytdStart, today)
  );
  const actualGrossYtd = visibleEntryRows.reduce((sum, row) => sum + Number(row.grossPay), 0);
  const actualNetYtd = visibleEntryRows.reduce((sum, row) => sum + Number(row.netPay), 0);
  const employerStatutoryYtd = visibleEntryRows.reduce((sum, row) => sum + traceInputNumber(row.trace, "employerStatutoryCost"), 0);
  const loadedPayrollYtd = actualGrossYtd + employerStatutoryYtd;

  const benefitPlanById = new Map(benefitPlanRows.map((plan) => [plan.id, plan]));
  const employerBenefitMonthlyRunRate = benefitEnrollmentRows
    .filter((row) =>
      visibleEmployeeIds.has(row.employeeId)
      && row.status === "active"
      && row.startedOn <= today
      && (!row.endedOn || row.endedOn >= today)
    )
    .reduce((sum, enrollment) => {
      const plan = benefitPlanById.get(enrollment.planId);
      return sum + (plan?.active ? Number(plan.employerShare) : 0);
    }, 0);

  const currentDate = new Date(today + "T00:00:00Z");
  const startDate = new Date(ytdStart + "T00:00:00Z");
  const nextYear = new Date(Date.UTC(currentDate.getUTCFullYear() + 1, 0, 1));
  const daysInYear = Math.round((nextYear.getTime() - startDate.getTime()) / 86_400_000);
  const elapsedDays = daysBetween(startDate, currentDate) + 1;
  const annualizedLoadedPayroll = loadedPayrollYtd > 0
    ? (loadedPayrollYtd / elapsedDays) * daysInYear
    : 0;
  const forecastAnnualLoadedCost = annualizedLoadedPayroll + employerBenefitMonthlyRunRate * 12;
  const positionSalaryBudget = visiblePositions
    .filter((row) => ["approved", "open", "filled"].includes(row.status))
    .reduce((sum, row) => sum + Number(row.annualBudget), 0);
  const currentPlan = access.companyWide
    ? planRows.find((plan) => plan.status === "active" && plan.startDate <= today && plan.endDate >= today) ?? null
    : null;

  const visibleSurveys = surveyRows.filter((survey) =>
    access.companyWide || survey.audienceOrgUnitId === null || survey.audienceOrgUnitId === access.orgUnitId
  );
  const engagementTrend = visibleSurveys.map((survey) => {
    const scopedResponses = responseRows.filter((response) =>
      response.surveyId === survey.id
      && (access.companyWide || response.orgUnitIdSnapshot === access.orgUnitId)
    );
    const threshold = normalizedPrivacyThreshold(survey.privacyThreshold);
    const reportable = reportableCohort(scopedResponses.length, threshold);
    const responseIds = new Set(scopedResponses.map((response) => response.id));
    const surveyQuestionIds = new Set(questionRows.filter((question) => question.surveyId === survey.id).map((question) => question.id));
    const scopedAnswers = answerRows.filter((answer) => responseIds.has(answer.responseId) && surveyQuestionIds.has(answer.questionId));
    const enpsQuestionIds = new Set(questionRows.filter((question) => question.surveyId === survey.id && question.type === "enps_0_10").map((question) => question.id));
    const ratingQuestionIds = new Set(questionRows.filter((question) => question.surveyId === survey.id && question.type === "rating_1_5").map((question) => question.id));
    const enpsValues = scopedAnswers
      .filter((answer) => enpsQuestionIds.has(answer.questionId) && answer.numericValue !== null)
      .map((answer) => Number(answer.numericValue))
      .filter((value) => Number.isFinite(value));
    const ratingValues = scopedAnswers
      .filter((answer) => ratingQuestionIds.has(answer.questionId) && answer.numericValue !== null)
      .map((answer) => Number(answer.numericValue))
      .filter((value) => Number.isFinite(value));

    return {
      surveyId: survey.id,
      name: survey.name,
      kind: survey.kind,
      status: survey.status,
      anonymous: survey.anonymous,
      date: survey.closesAt?.toISOString?.() ?? survey.closesAt ?? survey.opensAt?.toISOString?.() ?? survey.opensAt ?? survey.createdAt.toISOString(),
      reportable,
      responseCount: access.companyWide || reportable ? scopedResponses.length : null,
      enps: reportable && enpsValues.length ? enpsSummary(enpsValues).score : null,
      averageRating: reportable && ratingValues.length ? engagementAverage(ratingValues) : null,
    };
  }).slice(0, 12);

  return Response.json({
    generatedAt: new Date().toISOString(),
    asOfDate: today,
    access,
    privacyThreshold: HCM_ANALYTICS_PRIVACY_THRESHOLD,
    executive: {
      activeHeadcount: activeEmployees.length,
      netGrowthYtd: hiresYtd - separationsYtd,
      turnoverRateYtd,
      openPositions,
      vacancyRate,
      medianTimeToFillDays: medianNumber(timeToFillDays),
      averagePerformanceScore: performanceReportable ? averageNumber(performanceScores) : null,
      careerReadyEmployees: mobilityReportable ? readyRows.length : null,
      latestReportableEnps: engagementTrend.find((row) => row.enps !== null)?.enps ?? null,
    },
    headcount: {
      current: currentHeadcount,
      openingYtd: openingHeadcount,
      hiresYtd,
      separationsYtd,
      turnoverRateYtd,
      trend: headcountTrend,
      methodology: "Turnover uses released separation records divided by average opening/current reconstructed headcount.",
    },
    recruiting: {
      openRequisitions: visibleRequisitions.filter((row) => !["filled", "cancelled"].includes(row.status)).length,
      applicants: visibleApplicants.length,
      hires: visibleApplicants.filter((row) => row.stage === "hired").length,
      averageTimeToFillDays: averageNumber(timeToFillDays),
      medianTimeToFillDays: medianNumber(timeToFillDays),
      funnel,
      methodology: "Time-to-fill runs from requisition creation to the recorded hired timestamp.",
    },
    workforce: {
      positions: visiblePositions.length,
      positionStatus,
      openPositions,
      filledPositions,
      vacancyRate,
      averageSpanOfControl: averageSpan,
      maxSpanOfControl: spanRows[0]?.directReports ?? 0,
      spanOfControl: spanRows.slice(0, 12),
    },
    performance: {
      reportable: performanceReportable,
      reviewCount: performanceReportable ? performanceScores.length : null,
      averageScore: performanceReportable ? averageNumber(performanceScores) : null,
      medianScore: performanceReportable ? medianNumber(performanceScores) : null,
      distribution: performanceReportable ? performanceDistribution(performanceScores) : [],
      cycles: performanceCycles,
      suppressionReason: performanceReportable ? null : "At least 5 completed scored reviews are required before performance distribution is shown.",
    },
    compensation: {
      reportable: compensationReportable,
      monthlyPayPopulation: monthlyCompRows.length >= HCM_ANALYTICS_PRIVACY_THRESHOLD ? monthlyCompRows.length : null,
      bandCoveragePercent: monthlyCompRows.length >= HCM_ANALYTICS_PRIVACY_THRESHOLD
        ? percent(bandedCompRows.length, monthlyCompRows.length)
        : null,
      averageCompaRatio: compensationReportable
        ? averageNumber(bandedCompRows.map((row) => row.compaRatio ?? 0))
        : null,
      distribution: safeBandDistribution,
      suppressedBucketsPresent: compensationReportable && safeBandDistribution.some((row) => row.suppressed),
      latestCycle: latestCompensationCycle ? {
        id: latestCompensationCycle.id,
        name: latestCompensationCycle.name,
        status: latestCompensationCycle.status,
        effectiveDate: latestCompensationCycle.effectiveDate,
        totalBudget: access.companyWide ? Number(latestCompensationCycle.totalBudget) : null,
        visibleCommittedAnnualizedIncrease: roundMoney(committedAnnualizedIncrease),
      } : null,
      suppressionReason: compensationReportable ? null : "At least 5 employees with monthly pay and matched salary bands are required before compa-ratio distribution is shown.",
    },
    mobility: {
      reportable: mobilityReportable,
      employeesWithReadiness: mobilityReportable ? readinessRows.length : null,
      readyForMove: mobilityReportable ? readyRows.length : null,
      readyForMovePercent: mobilityReportable ? percent(readyRows.length, readinessRows.length) : null,
      verifiedSkillCoveragePercent: activeEmployees.length >= HCM_ANALYTICS_PRIVACY_THRESHOLD
        ? percent(activeEmployees.filter((employee) => skillEvidenceEmployees.has(employee.id)).length, activeEmployees.length)
        : null,
      targetProfiles: safeTargetProfiles,
      suppressionReason: mobilityReportable ? null : "At least 5 employees with calculable readiness are required before mobility aggregates are shown.",
    },
    cost: {
      actualGrossYtd: roundMoney(actualGrossYtd),
      actualNetYtd: roundMoney(actualNetYtd),
      employerStatutoryYtd: roundMoney(employerStatutoryYtd),
      loadedPayrollYtd: roundMoney(loadedPayrollYtd),
      employerBenefitMonthlyRunRate: roundMoney(employerBenefitMonthlyRunRate),
      forecastAnnualLoadedCost: roundMoney(forecastAnnualLoadedCost),
      positionSalaryBudget: roundMoney(positionSalaryBudget),
      forecastVsPositionBudget: positionSalaryBudget > 0 ? roundMoney(forecastAnnualLoadedCost - positionSalaryBudget) : null,
      workforcePlan: currentPlan ? { id: currentPlan.id, name: currentPlan.name, budget: Number(currentPlan.budget) } : null,
      methodology: "Loaded payroll uses released gross pay plus employer statutory cost persisted in payroll trace; current employer benefit share is annualized separately. Position annual budget is a salary-budget proxy, not a full accounting forecast.",
      scopeCaveat: access.companyWide ? null : "Historical payroll entries are attributed to the employee's current organization unit because payroll entries do not yet snapshot org-unit ownership.",
    },
    engagement: {
      surveys: engagementTrend,
      methodology: "Engagement scores are returned only after each survey's privacy threshold is met. Raw anonymous comments are never included.",
    },
    coverage: {
      employees: visibleEmployees.length,
      activeEmployees: activeEmployees.length,
      positions: visiblePositions.length,
      completedScoredReviews: performanceScores.length,
      monthlyPayWithBand: bandedCompRows.length,
      readinessEmployees: readinessRows.length,
      releasedPayrollEntriesYtd: visibleEntryRows.length,
    },
  });
}

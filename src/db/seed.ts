import { count, eq, inArray } from "drizzle-orm";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalDelegations,
  approvalTasks,
  auditEvents,
  bankTemplates,
  biometricDevices,
  calamityAdvisories,
  disciplinaryCases,
  employeeLoans,
  employees,
  freelancerProfiles,
  holidays,
  jobApplicants,
  jobRequisitions,
  leaveConversions,
  leaveRequests,
  loanPayments,
  minWageOrders,
  organizations,
  orgUnits,
  payrollEntries,
  payrollRuns,
  pricingPlans,
  separationRecords,
  subscriptions,
  timePunches,
  userOrganizations,
  users,
} from "@/db/schema";
import { ensureLifecycleProvisioning } from "@/lib/provisioning";
import { NATIONAL_HOLIDAYS_2026, WAGE_ORDERS } from "@/lib/wage-orders";
import { ensureSubscription } from "@/lib/billing";
import { DEFAULT_PRICING_PLANS } from "@/lib/pricing-catalog";
import { generateBackupCodes, hashPassword } from "@/lib/crypto";
import { encryptBankAccount } from "@/lib/bank-account-crypto";

const people = [
  ["Mariel", "Santos", "Operations Lead", "MS", "Active", "Regular", "38500.00", false, "1234567890", "BDO", "09171230001"],
  ["Jonas", "Reyes", "Customer Experience", "JR", "Active", "Regular", "29200.00", false, "2234567890", "BPI", "09171230002"],
  ["Aira", "Villanueva", "People Operations", "AV", "On leave", "Regular", "36500.00", false, "3234567890", "UB", "09171230003"],
  ["Paolo", "Cruz", "Finance Associate", "PC", "Active", "Regular", "32500.00", false, "4234567890", "BDO", "09171230004"],
  ["Nina", "Garcia", "Support Specialist", "NG", "Active", "Probationary", "24500.00", false, "5234567890", "BPI", "09171230005"],
  ["Rico", "Mendoza", "Warehouse Officer", "RM", "Disciplinary review", "Regular", "21800.00", false, "6234567890", "BDO", "09171230006"],
  ["Trish", "Dela Cruz", "Account Executive", "TD", "Separating", "Regular", "41000.00", false, "7234567890", "GCASH", "09171230007"],
  ["Eli", "Tan", "Implementation Analyst", "ET", "Active", "Regular", "34800.00", false, "8234567890", "UB", "09171230008"],
] as const;

/**
 * Demo data only exists when DEMO_MODE is explicitly enabled.
 * A production instance boots with zero users and goes through /setup instead.
 */
export const DEMO_MODE = process.env.NODE_ENV !== "production" && process.env.DEMO_MODE === "true";

export async function ensureSeedData() {
  const [{ value }] = await db.select({ value: count() }).from(organizations);

  // Production may bootstrap global reference data, but it must never seed
  // fictional employees, loans, disciplinary cases, devices, or demo payrolls
  // into a real customer workspace.
  if (!DEMO_MODE) {
    await ensureReferenceData();
    return;
  }

  if (value > 0) {
    await ensureReferenceData();

    const demoOrgs = await db
      .select()
      .from(organizations)
      .where(inArray(organizations.name, ["Loom & Local", "Mantra Studio", "Santos Retail Group", "Mika, self-employed"]));

    // Never graft demo fixtures onto an existing customer database. If this
    // deployment did not start as a demo database, the public demo endpoint
    // stays unavailable until a dedicated demo database is provisioned.
    if (!demoOrgs.some((org) => org.name === "Loom & Local")) return;

    await ensureDemoUser(demoOrgs.map((org) => org.id));
    await ensureExtendedSeed();
    return;
  }

  const orgValues = [
    { name: "Loom & Local", legalName: "Loom & Local Philippines Inc.", accountType: "business", plan: "Scale", employeeCount: 8, color: "#176B5D" },
    { name: "Mantra Studio", legalName: "Mantra Studio Co.", accountType: "business", plan: "Core", employeeCount: 7, color: "#6045A5" },
    { name: "Santos Retail Group", legalName: "Santos Retail Group Inc.", accountType: "enterprise", plan: "Enterprise", employeeCount: 8, color: "#BC5D32" },
    { name: "Mika, self-employed", legalName: "Mika Ramos", accountType: "freelancer", plan: "Solo", employeeCount: 1, color: "#2D7D8B" },
  ];
  const seededOrgs = await db.insert(organizations).values(orgValues).returning();
  const [loom, mantra, santos, freelance] = seededOrgs;

  const units = await db.insert(orgUnits).values([
    { organizationId: loom.id, type: "Branch", name: "Makati HQ", code: "MKT" },
    { organizationId: loom.id, type: "Branch", name: "Cebu Hub", code: "CEB" },
    { organizationId: loom.id, type: "Department", name: "Operations", code: "OPS" },
    { organizationId: mantra.id, type: "Branch", name: "Quezon City Studio", code: "QC" },
    { organizationId: mantra.id, type: "Department", name: "Creative", code: "CRT" },
    { organizationId: santos.id, type: "Branch", name: "Pasig Distribution", code: "PSG" },
    { organizationId: santos.id, type: "Department", name: "Retail Operations", code: "RTL" },
  ]).returning();

  for (const [orgIndex, org] of [loom, mantra, santos].entries()) {
    const orgPeople = people.slice(0, orgIndex === 1 ? 7 : 8);
    const defaultUnit = units[orgIndex === 0 ? 2 : orgIndex === 1 ? 4 : 6];
    await db.insert(employees).values(orgPeople.map((person, index) => ({
      organizationId: org.id,
      orgUnitId:
        orgIndex === 0
          ? (index < 3 ? units[0].id : index < 5 ? units[1].id : units[2].id)
          : defaultUnit.id,
      employeeNo: `${orgIndex === 0 ? "LL" : orgIndex === 1 ? "MS" : "SR"}-${String(index + 101).padStart(3, "0")}`,
      firstName: person[0],
      lastName: person[1],
      title: person[2],
      avatarInitials: person[3],
      status: person[4],
      employmentType: person[5],
      basicRate: person[6],
      mwe: person[7],
      bankAccount: encryptBankAccount(person[8]),
      bankCode: person[9],
      mobile: person[10],
      email: `${person[0]}.${person[1]}`.toLowerCase().replace(/[^a-z.]/g, "") + "@linaw.ph",
      startDate: `202${(index % 4) + 1}-0${(index % 8) + 1}-15`,
    })));
  }

  const loomPeople = await db.select().from(employees).where(eq(employees.organizationId, loom.id));
  const punchRows = loomPeople.flatMap((employee, index) => {
    const base = [
      {
        organizationId: loom.id,
        employeeId: employee.id,
        workDate: "2026-03-10",
        timeIn: new Date("2026-03-10T09:00:00"),
        timeOut: new Date("2026-03-10T18:00:00"),
        shiftStart: "09:00",
        shiftEnd: "18:00",
        status: "Complete",
      },
      {
        organizationId: loom.id,
        employeeId: employee.id,
        workDate: "2026-03-11",
        timeIn: new Date("2026-03-11T09:00:00"),
        timeOut: new Date("2026-03-11T18:30:00"),
        shiftStart: "09:00",
        shiftEnd: "18:00",
        status: "Complete",
      },
    ];
    if (index === 2) {
      base.push({
        organizationId: loom.id,
        employeeId: employee.id,
        workDate: "2026-03-12",
        timeIn: new Date("2026-03-12T09:00:00"),
        timeOut: null as unknown as Date,
        shiftStart: "09:00",
        shiftEnd: "18:00",
        status: "Incomplete",
      });
    }
    if (index === 5) {
      base.push({
        organizationId: loom.id,
        employeeId: employee.id,
        workDate: "2026-03-14",
        timeIn: new Date("2026-03-14T09:20:00"),
        timeOut: new Date("2026-03-14T17:18:00"),
        shiftStart: "09:00",
        shiftEnd: "18:00",
        status: "Exception",
      });
    }
    return base;
  });
  await db.insert(timePunches).values(punchRows);

  const [processingRun, draftRun, releasedRun] = await db.insert(payrollRuns).values([
    { organizationId: loom.id, periodLabel: "Mar 1–15, 2026", periodStart: "2026-03-01", periodEnd: "2026-03-15", scopeLabel: "All locations", scopeOrgUnitId: null, status: "Needs review", payDate: "2026-03-18", employeeCount: 8, grossPay: "346820.00", netPay: "285614.42", exceptions: 2, ruleVersion: "PH-2026.01", processedChunks: 1, totalChunks: 1 },
    { organizationId: loom.id, periodLabel: "Feb 16–28, 2026", periodStart: "2026-02-16", periodEnd: "2026-02-28", scopeLabel: "Makati HQ", scopeOrgUnitId: units[0].id, status: "Draft", payDate: "2026-03-05", employeeCount: 3, grossPay: "261400.00", netPay: "218909.88", exceptions: 0, ruleVersion: "PH-2026.01" },
    { organizationId: loom.id, periodLabel: "Feb 1–15, 2026", periodStart: "2026-02-01", periodEnd: "2026-02-15", scopeLabel: "All locations", scopeOrgUnitId: null, status: "Released", payDate: "2026-02-18", employeeCount: 8, grossPay: "341200.00", netPay: "281950.37", exceptions: 0, ruleVersion: "PH-2026.01" },
  ]).returning();

  await db.insert(payrollEntries).values(loomPeople.map((employee, index) => ({
    payrollRunId: processingRun.id,
    employeeId: employee.id,
    grossPay: [38500, 29200, 36500, 32500, 24500, 21800, 41000, 34800][index].toFixed(2),
    deductions: [7284, 5540, 6942, 6175, 4655, 4142, 7790, 6608][index].toFixed(2),
    netPay: [31216, 23660, 29558, 26325, 19845, 17658, 33210, 28192][index].toFixed(2),
    status: index === 2 || index === 5 ? "Exception" : "Ready",
    lineItems: [
      { code: "BASIC", label: "Basic / worked pay", amount: [38500, 29200, 36500, 32500, 24500, 21800, 41000, 34800][index].toFixed(2) },
      { code: "SSS", label: "SSS contribution", amount: (-[7284, 5540, 6942, 6175, 4655, 4142, 7790, 6608][index] * 0.25).toFixed(2) },
    ],
    trace: { ruleVersion: "PH-2026.01", inputs: ["approved timesheet", "SSS 2026", "semi-monthly table"] },
  })))

  // Released history keeps the Employee sandbox populated with a real pay
  // period. Self-service reads released payroll entries directly and the PDF
  // download is generated from the same stored line items.
  await db.insert(payrollEntries).values(loomPeople.map((employee, index) => {
    const gross = [37400, 28400, 35200, 31600, 23800, 21000, 39800, 33600][index];
    const deductions = [7100, 5380, 6680, 6000, 4520, 3990, 7560, 6380][index];
    const net = gross - deductions;
    return {
      payrollRunId: releasedRun.id,
      employeeId: employee.id,
      grossPay: gross.toFixed(2),
      deductions: deductions.toFixed(2),
      netPay: net.toFixed(2),
      status: "Ready",
      lineItems: [
        { code: "BASIC", label: "Basic / worked pay", amount: gross.toFixed(2) },
        { code: "SSS", label: "SSS contribution", amount: (-(deductions * 0.24)).toFixed(2) },
        { code: "PHIC", label: "PhilHealth contribution", amount: (-(deductions * 0.18)).toFixed(2) },
        { code: "HDMF", label: "Pag-IBIG contribution", amount: (-(deductions * 0.06)).toFixed(2) },
        { code: "WHT", label: "Withholding tax", amount: (-(deductions * 0.52)).toFixed(2) },
      ],
      trace: { ruleVersion: "PH-2026.01", inputs: ["approved timesheet", "released demo payroll"] },
    };
  }));

;

  await db.insert(pricingPlans).values(DEFAULT_PRICING_PLANS.map((plan) => ({ ...plan })));

  await db.insert(freelancerProfiles).values({
    organizationId: freelance.id,
    monthlyIncome: "82000.00",
    annualExpenses: "180000.00",
    filingMethod: "8% flat",
    nextDueDate: "2026-04-15",
  });

  await db.insert(calamityAdvisories).values({
    organizationId: loom.id,
    advisoryNumber: "DOLE-NCR-2026-03",
    policy: "Hazard pay +30%",
    premiumPercent: 30,
    startDate: "2026-03-10",
    endDate: "2026-03-12",
    affectedUnit: "Cebu Hub",
    active: true,
  });

  await db.insert(bankTemplates).values([
    { name: "BDO DAT", version: "2026.01", format: "DAT", mappings: { account: "column_3", amount: "column_8", name: "column_5" } },
    { name: "BPI / UnionBank", version: "2026.01", format: "CSV", mappings: { account: "account_number", amount: "net_pay", name: "employee_name" } },
    { name: "GCash Disbursement", version: "2026.01", format: "CSV", mappings: { account: "mobile", amount: "net_pay", name: "employee_name" } },
  ]);

  await db.insert(approvalTasks).values([
    { organizationId: loom.id, title: "Review March payroll", detail: "2 timekeeping exceptions need a decision", approver: "Mariel Santos", dueLabel: "Due today", priority: "High" },
    { organizationId: loom.id, title: "Approve leave request", detail: "Aira Villanueva · Mar 17–18", approver: "Mariel Santos", dueLabel: "Due in 2 days", priority: "Normal" },
    { organizationId: loom.id, title: "Offboarding checklist", detail: "Trish Dela Cruz · access review", approver: "Mariel Santos", dueLabel: "Due Mar 20", priority: "Normal" },
  ]);

  await db.insert(approvalDelegations).values({
    organizationId: loom.id,
    fromApprover: "Mariel Santos",
    toApprover: "Celine Yao",
    reason: "Out of office, client audit week",
    startsOn: "2026-01-01",
    endsOn: "2026-12-31",
    active: true,
  });

  await db.insert(auditEvents).values([
    { organizationId: loom.id, actor: "Celine Yao", action: "Payroll run created", resource: "Mar 1–15, 2026", metadata: { ruleVersion: "PH-2026.01" } },
    { organizationId: loom.id, actor: "Jonas Reyes", action: "Timesheet submitted", resource: "Mar 1–15, 2026", metadata: {} },
    { organizationId: loom.id, actor: "System", action: "Hazard pay rule applied", resource: "DOLE-NCR-2026-03", metadata: { ruleVersion: "PH-2026.01" } },
  ]);

  await ensureDemoUser(seededOrgs.map((org) => org.id));
  await ensureExtendedSeed();
  void draftRun;
  void releasedRun;
}

async function ensureReferenceData() {
  const orgs = await db
    .select()
    .from(organizations)
    .where(inArray(organizations.name, ["Loom & Local", "Mantra Studio", "Santos Retail Group", "Mika, self-employed"]));
  for (const org of orgs) {
    await ensureSubscription(org.id);
  }

  const [{ value: pricingCount }] = await db.select({ value: count() }).from(pricingPlans);
  if (pricingCount === 0) {
    await db.insert(pricingPlans).values(DEFAULT_PRICING_PLANS.map((plan) => ({ ...plan })));
  }

  const [{ value: wageCount }] = await db.select({ value: count() }).from(minWageOrders);
  if (wageCount === 0) {
    await db.insert(minWageOrders).values(WAGE_ORDERS.map((row) => ({
      region: row.region,
      dailyRate: row.dailyRate.toFixed(2),
      wageOrder: row.wageOrder,
      effectiveOn: row.effectiveOn,
    })));
  }

  const [{ value: holidayCount }] = await db.select({ value: count() }).from(holidays);
  if (holidayCount === 0) {
    await db.insert(holidays).values(NATIONAL_HOLIDAYS_2026.map((row) => ({
      holidayDate: row.date,
      name: row.name,
      kind: row.kind,
    })));
  }

  const [{ value: templateCount }] = await db.select({ value: count() }).from(bankTemplates);
  if (templateCount === 0) {
    await db.insert(bankTemplates).values([
      { name: "BDO DAT", version: "2026.01", format: "DAT", mappings: { account: "column_3", amount: "column_8", name: "column_5" } },
      { name: "BPI / UnionBank", version: "2026.01", format: "CSV", mappings: { account: "account_number", amount: "net_pay", name: "employee_name" } },
      { name: "GCash Disbursement", version: "2026.01", format: "CSV", mappings: { account: "mobile", amount: "net_pay", name: "employee_name" } },
    ]);
  }
}

async function ensureDemoUser(organizationIds?: number[]) {
  if (!DEMO_MODE) return;
  const existing = await db.select().from(users).where(eq(users.email, "celine@linaw.ph")).limit(1);
  if (existing.length) return;

  // Fixed demo secret so local/sandbox login can complete the real TOTP challenge.
  const secret = "JBSWY3DPEHPK3PXP";
  const [user] = await db.insert(users).values({
    email: "celine@linaw.ph",
    name: "Celine Yao",
    passwordHash: hashPassword("LinawDemo2026!"),
    role: "bookkeeper",
    totpSecret: secret,
    totpEnabled: true,
    backupCodes: generateBackupCodes(),
  }).returning();

  const orgIds =
    organizationIds ??
    (
      await db
        .select()
        .from(organizations)
        .where(inArray(organizations.name, ["Loom & Local", "Mantra Studio", "Santos Retail Group", "Mika, self-employed"]))
    ).map((org) => org.id);
  if (orgIds.length) {
    await db.insert(userOrganizations).values(orgIds.map((organizationId) => ({
      userId: user.id,
      organizationId,
      role: "admin",
    })));
  }
}

export const DEMO_CREDENTIALS = {
  email: "celine@linaw.ph",
  password: "LinawDemo2026!",
};

async function ensureExtendedSeed() {
  // Every organization gets a subscription row so plan gating is live from
  // first boot (14-day trial on Core). A billing provider only has to update
  // this table; entitlements follow automatically.
  const orgs = await db.select().from(organizations);
  for (const org of orgs) {
    const existing = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, org.id)).limit(1);
    if (existing.length) continue;
    await db.insert(subscriptions).values({
      organizationId: org.id,
      plan: org.accountType === "enterprise" ? "Enterprise" : org.accountType === "freelancer" ? "Solo" : "Core",
      status: org.accountType === "enterprise" ? "active" : "trialing",
      seatLimit: org.accountType === "enterprise" ? 10000 : 10,
      trialEndsAt: org.accountType === "enterprise" ? null : new Date(Date.now() + 14 * 86_400_000),
      periodStart: new Date(),
    });
  }

  const [{ value: wageCount }] = await db.select({ value: count() }).from(minWageOrders);
  if (wageCount === 0) {
    await db.insert(minWageOrders).values(WAGE_ORDERS.map((row) => ({
      region: row.region,
      dailyRate: row.dailyRate.toFixed(2),
      wageOrder: row.wageOrder,
      effectiveOn: row.effectiveOn,
    })));
  }

  const [{ value: holidayCount }] = await db.select({ value: count() }).from(holidays);
  if (holidayCount === 0) {
    await db.insert(holidays).values(NATIONAL_HOLIDAYS_2026.map((row) => ({
      holidayDate: row.date,
      name: row.name,
      kind: row.kind,
    })));
  }

  const [loom] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, "Loom & Local"))
    .limit(1);
  if (!loom) return;

  await ensureLifecycleProvisioning(loom.id);

  const [{ value: leaveCount }] = await db.select({ value: count() }).from(leaveRequests);
  if (leaveCount === 0) {
    const staff = await db.select().from(employees).where(eq(employees.organizationId, loom.id));
    const aira = staff.find((row) => row.firstName === "Aira");
    const trish = staff.find((row) => row.firstName === "Trish");
    const tasks = await db.select().from(approvalTasks).where(eq(approvalTasks.organizationId, loom.id));
    const leaveTask = tasks.find((task) => task.title.toLowerCase().includes("leave"));

    if (aira) {
      await db.insert(leaveRequests).values({
        organizationId: loom.id,
        employeeId: aira.id,
        leaveType: "Emergency leave",
        startDate: "2026-03-17",
        endDate: "2026-03-18",
        days: "2.0",
        reason: "Family emergency",
        status: "Pending",
        approvalTaskId: leaveTask?.id ?? null,
      });
    }
    if (trish) {
      await db.insert(leaveRequests).values({
        organizationId: loom.id,
        employeeId: trish.id,
        leaveType: "Annual leave",
        startDate: "2026-03-23",
        endDate: "2026-03-23",
        days: "1.0",
        reason: "Personal",
        status: "Approved",
      });
    }
  }

  // 1. Extended Bank Templates for Top PH Banks
  const existingTemplates = await db.select().from(bankTemplates);
  const templateNames = new Set(existingTemplates.map((t) => t.name));
  const newTemplates = [
    { name: "BPI Bizlink", version: "2026.02", format: "CSV", mappings: { account: "Account_Number", amount: "Amount", name: "Beneficiary_Name" } },
    { name: "UnionBank OneHub", version: "2026.02", format: "CSV", mappings: { account: "Beneficiary_Account", amount: "Amount", name: "Beneficiary_Name" } },
    { name: "Metrobank eGov (MBTC)", version: "2026.02", format: "CSV", mappings: { account: "Account_No", amount: "Amount", name: "Beneficiary_Name" } },
    { name: "Security Bank DigiBanker", version: "2026.02", format: "CSV", mappings: { account: "Bene_Account", amount: "Credit_Amount", name: "Bene_Name" } },
    { name: "ChinaBank eGov (CBC)", version: "2026.02", format: "CSV", mappings: { account: "Crediting_Account", amount: "Disbursement_Amount", name: "Account_Name" } },
    { name: "EastWest Bank eGov", version: "2026.02", format: "CSV", mappings: { account: "Destination_Account", amount: "Net_Amount", name: "Recipient_Name" } },
    { name: "Maya Business (PayMaya)", version: "2026.02", format: "CSV", mappings: { account: "Recipient_Mobile", amount: "Disbursement_Amount", name: "Recipient_Name" } },
    { name: "Bank of America CashPro (ACH)", version: "2026.02", format: "CSV", mappings: { account: "Receiving_Account", amount: "Amount", name: "Account_Holder" } },
  ];
  for (const t of newTemplates) {
    if (!templateNames.has(t.name)) {
      await db.insert(bankTemplates).values(t);
    }
  }

  // 2. Biometric Devices (ADMS & Face/Fingerprint Sync)
  const existingDevices = await db.select().from(biometricDevices).where(eq(biometricDevices.organizationId, loom.id));
  if (existingDevices.length === 0) {
    await db.insert(biometricDevices).values([
      {
        organizationId: loom.id,
        deviceModel: "ZKTeco K40 (Fingerprint / RFID)",
        serialNumber: "ZK-MKT-HQ-01",
        ipAddress: "192.168.10.45",
        port: 4370,
        branchName: "Makati HQ",
        protocol: "ADMS",
        status: "online",
        lastSyncAt: new Date(),
      },
      {
        organizationId: loom.id,
        deviceModel: "Hikvision DS-K1T (Face / Retina)",
        serialNumber: "HIK-CEB-HUB-02",
        ipAddress: "192.168.20.12",
        port: 8000,
        branchName: "Cebu Hub",
        protocol: "Push SDK",
        status: "online",
        lastSyncAt: new Date(),
      },
    ]);
  }

  // 3. Employee 201 File Enrichment (TIN, SSS, PhilHealth, Pag-IBIG numbers)
  const loomStaff = await db.select().from(employees).where(eq(employees.organizationId, loom.id));
  for (const [idx, emp] of loomStaff.entries()) {
    if (!emp.tin || !emp.sssNo) {
      await db.update(employees).set({
        tin: `123-456-${String(idx + 789).padStart(3, "0")}-000`,
        sssNo: `34-${String(1000000 + idx * 8731).slice(0, 7)}-${idx % 9}`,
        philHealthNo: `12-${String(200000000 + idx * 4521).slice(0, 9)}-${idx % 9}`,
        pagIbigNo: `1210-${String(3000 + idx * 311)}-${String(4000 + idx * 111)}`,
        birthDate: `199${(idx % 8) + 1}-0${(idx % 9) + 1}-20`,
        emergencyContact: idx % 2 === 0 ? "Maria Santos (Spouse)" : "Roberto Reyes (Parent)",
        emergencyPhone: `0917${String(idx + 1000000).slice(0, 7)}`,
        dependentsCount: idx % 3,
        education: idx % 2 === 0 ? "BS Accountancy (UST)" : "BS Computer Science (DLSU)",
      }).where(eq(employees.id, emp.id));
    }
  }

  // 4. Employee Loans (SSS Salary Loan, Pag-IBIG MPL, Company Loan)
  const existingLoans = await db.select().from(employeeLoans).where(eq(employeeLoans.organizationId, loom.id));
  if (existingLoans.length === 0 && loomStaff.length >= 6) {
    const jonas = loomStaff.find((e) => e.firstName === "Jonas") ?? loomStaff[1];
    const paolo = loomStaff.find((e) => e.firstName === "Paolo") ?? loomStaff[3];
    const rico = loomStaff.find((e) => e.firstName === "Rico") ?? loomStaff[5];

    if (jonas) {
      const [loan1] = await db.insert(employeeLoans).values({
        organizationId: loom.id,
        employeeId: jonas.id,
        loanType: "SSS Salary Loan",
        referenceNo: "SSS-SL-2025-9812",
        principal: "25000.00",
        monthlyAmortization: "1041.67",
        cutoffDeduction: "520.83",
        remainingBalance: "18750.00",
        totalPaid: "6250.00",
        status: "active",
        startDate: "2025-10-01",
        endDate: "2027-09-30",
        notes: "24-month SSS salary loan amortized semi-monthly",
      }).returning();

      await db.insert(loanPayments).values({
        loanId: loan1.id,
        amount: "520.83",
        paymentDate: "2026-02-28",
        reference: "Payroll Feb 16-28 Auto-deduct",
      });
    }

    if (paolo) {
      await db.insert(employeeLoans).values({
        organizationId: loom.id,
        employeeId: paolo.id,
        loanType: "Pag-IBIG Multi-Purpose Loan (MPL)",
        referenceNo: "HDMF-MPL-4412",
        principal: "30000.00",
        monthlyAmortization: "1250.00",
        cutoffDeduction: "625.00",
        remainingBalance: "22500.00",
        totalPaid: "7500.00",
        status: "active",
        startDate: "2025-09-01",
        endDate: "2027-08-31",
        notes: "HDMF calamity / multipurpose cash loan amortized semi-monthly",
      });
    }

    if (rico) {
      await db.insert(employeeLoans).values({
        organizationId: loom.id,
        employeeId: rico.id,
        loanType: "Company Emergency Loan",
        referenceNo: "CO-EMERG-104",
        principal: "15000.00",
        monthlyAmortization: "1000.00",
        cutoffDeduction: "500.00",
        remainingBalance: "8000.00",
        totalPaid: "7000.00",
        status: "active",
        startDate: "2025-08-01",
        endDate: "2026-10-31",
        notes: "Internal company assistance fund",
      });
    }
  }

  // 5. Disciplinary Cases (Twin Notice Rule: NTE -> Explanation -> NOD)
  const existingDiscipline = await db.select().from(disciplinaryCases).where(eq(disciplinaryCases.organizationId, loom.id));
  if (existingDiscipline.length === 0) {
    const rico = loomStaff.find((e) => e.firstName === "Rico") ?? loomStaff[5];
    if (rico) {
      await db.insert(disciplinaryCases).values({
        organizationId: loom.id,
        employeeId: rico.id,
        caseNumber: "HR-DISC-2026-004",
        offense: "Habitual Tardiness & Unauthorized Undertime (Art. 297 Labor Code)",
        incidentDate: "2026-03-05",
        status: "nte_issued",
        nteIssuedAt: new Date("2026-03-06T10:00:00Z"),
        nteDetails: "Recorded 8 tardiness instances exceeding 30 minutes and 3 unauthorized undertimes in February 2026, violating Section 4.2 of the Company Code of Conduct. Required to submit written explanation within 5 calendar days.",
        employeeExplanation: "Delays caused by MRT-3 commuter rail suspension and subsequent flash floods along EDSA. Submitted MRT commuter advisory proof.",
        explanationSubmittedAt: new Date("2026-03-09T14:30:00Z"),
        hearingDate: new Date("2026-03-18T15:00:00Z"),
        penalty: "Under Review / Pre-Hearing",
      });
    }
  }

  // 6. Recruitment Pipeline (Job Requisitions & Candidates)
  const existingReqs = await db.select().from(jobRequisitions).where(eq(jobRequisitions.organizationId, loom.id));
  if (existingReqs.length === 0) {
    const [req1] = await db.insert(jobRequisitions).values({
      organizationId: loom.id,
      title: "Senior Fullstack Engineer - PH Payroll & Core",
      department: "Engineering",
      headcount: 2,
      salaryMin: "95000.00",
      salaryMax: "140000.00",
      employmentType: "Full-time",
      status: "interviewing",
      description: "Own the core calculation engine, SSS/BIR compliance pipelines, and high-concurrency payroll workers.",
    }).returning();

    const [req2] = await db.insert(jobRequisitions).values({
      organizationId: loom.id,
      title: "People Operations & Compliance Associate",
      department: "Human Resources",
      headcount: 1,
      salaryMin: "35000.00",
      salaryMax: "48000.00",
      employmentType: "Full-time",
      status: "open",
      description: "Manage 201 records, government portal remittances, and leave administration.",
    }).returning();

    await db.insert(jobApplicants).values([
      {
        requisitionId: req1.id,
        organizationId: loom.id,
        fullName: "Gian Carlo Dizon",
        email: "gian.dizon@techph.dev",
        phone: "09178881234",
        stage: "interview",
        rating: 5,
        notes: "Ex-Fintech engineer with 6 years building Philippine statutory tax and remittance pipelines.",
      },
      {
        requisitionId: req1.id,
        organizationId: loom.id,
        fullName: "Clarisse Tan",
        email: "clarisse.tan@talent.ph",
        phone: "09187772345",
        stage: "offer",
        rating: 4,
        offeredSalary: "115000.00",
        notes: "Strong system architecture background. Verbal offer accepted, drafting formal contract.",
      },
      {
        requisitionId: req2.id,
        organizationId: loom.id,
        fullName: "Bea Alonzo-Ramos",
        email: "bea.ramos@people.ph",
        phone: "09205553456",
        stage: "screening",
        rating: 4,
        notes: "CHRA certified with direct experience in SSS R-3 and PhilHealth EPRS portals.",
      },
    ]);
  }

  // 7. Separation & Clearance Records
  const existingSeparations = await db.select().from(separationRecords).where(eq(separationRecords.organizationId, loom.id));
  if (existingSeparations.length === 0) {
    const trish = loomStaff.find((e) => e.firstName === "Trish") ?? loomStaff[6];
    if (trish) {
      await db.insert(separationRecords).values({
        organizationId: loom.id,
        employeeId: trish.id,
        separationType: "resignation",
        noticeDate: "2026-02-15",
        lastDay: "2026-03-31",
        clearanceStatus: "in_progress",
        itCleared: true,
        adminCleared: true,
        financeCleared: false,
        hrCleared: false,
        prorated13thMonth: "10250.00",
        unusedLeaveCredits: "4.5",
        leaveMonetizationPay: "8386.36",
        taxAdjustment: "1250.00",
        loanDeductions: "0.00",
        netFinalPay: "19886.36",
        status: "draft",
        coeIssued: false,
      });
    }
  }
}

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, provisioningTasks } from "@/db/schema";

export const ONBOARDING_TASKS = [
  { title: "Government IDs on file (SSS / PhilHealth / Pag-IBIG / TIN)", owner: "People Ops" },
  { title: "Payroll bank / GCash account verified", owner: "Finance" },
  { title: "Laptop / workstation assigned", owner: "IT" },
  { title: "Email and software accounts provisioned", owner: "IT" },
  { title: "HMO enrollment submitted", owner: "People Ops" },
];

export const OFFBOARDING_TASKS = [
  { title: "Revoke email, SSO and software access", owner: "IT" },
  { title: "Recover laptop / assets", owner: "IT" },
  { title: "Final pay and 2316 queued", owner: "Finance" },
  { title: "HMO coverage end-dated", owner: "People Ops" },
  { title: "Exit interview completed", owner: "People Ops" },
];

export async function seedProvisioning(organizationId: number, employeeId: number, kind: "onboarding" | "offboarding") {
  const existing = await db.select().from(provisioningTasks).where(eq(provisioningTasks.employeeId, employeeId));
  if (existing.some((row) => row.kind === kind)) return existing.filter((row) => row.kind === kind);

  const templates = kind === "onboarding" ? ONBOARDING_TASKS : OFFBOARDING_TASKS;
  return db.insert(provisioningTasks).values(templates.map((item) => ({
    organizationId,
    employeeId,
    kind,
    title: item.title,
    owner: item.owner,
  }))).returning();
}

export async function ensureLifecycleProvisioning(organizationId: number) {
  const rows = await db.select().from(employees).where(eq(employees.organizationId, organizationId));
  for (const employee of rows) {
    await seedProvisioning(organizationId, employee.id, "onboarding");
    if (employee.status === "Separating") {
      await seedProvisioning(organizationId, employee.id, "offboarding");
    }
  }
}

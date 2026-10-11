
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { itAccessGrants, itDeviceEvents, itManagedDevices, employees, auditEvents } from "@/db/schema";

/**
 * Mark IT work as requested on employee separation. Neither the SSO provider
 * nor an MDM is called. Only an operator can confirm physical returns/revocation.
 * Idempotent conditional updates prevent duplicate transitions.
 */
export async function requestOffboardingIT(organizationId: number, employeeId: number) {
  return db.transaction(async tx => {
    const [employee] = await tx.select({ id: employees.id, status: employees.status }).from(employees)
      .where(and(eq(employees.organizationId, organizationId), eq(employees.id, employeeId))).limit(1);
    if (!employee || !["Separating", "Separated"].includes(employee.status)) return { accessRequests: 0, deviceRequests: 0 };
    const grants = await tx.update(itAccessGrants).set({ state: "revoke_requested", updatedAt: new Date() })
      .where(and(eq(itAccessGrants.organizationId, organizationId), eq(itAccessGrants.employeeId, employeeId), eq(itAccessGrants.state, "active")))
      .returning({ id: itAccessGrants.id });
    const devices = await tx.update(itManagedDevices).set({ state: "return_requested", updatedAt: new Date() })
      .where(and(eq(itManagedDevices.organizationId, organizationId), eq(itManagedDevices.employeeId, employeeId), eq(itManagedDevices.state, "assigned")))
      .returning({ id: itManagedDevices.id });
    if (devices.length) await tx.insert(itDeviceEvents).values(devices.map(d => ({
      organizationId, deviceId: d.id, employeeId, eventType: "offboarding_return_requested",
    })));
    if (grants.length || devices.length) await tx.insert(auditEvents).values({
      organizationId, actor: "IT lifecycle", action: "Offboarding access and device recovery requested",
      resource: "Employee " + employeeId, metadata: { employeeId, grantIds: grants.map(g => g.id), deviceIds: devices.map(d => d.id), remoteActionsExecuted: false },
    });
    return { accessRequests: grants.length, deviceRequests: devices.length };
  });
}

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, hcmLifecycleNotificationTasks } from "@/db/schema";

/**
 * The task and worker each have a valid FK but may not have the SAME employer.
 * Correlate organization IDs in the join itself, before employee names/numbers
 * are projected, rather than relying only on the task's organization ID.
 *
 * Authorization is enforced by the route before calling this DB reader.
 */
export async function readScopedLifecycleNotificationTasks(input: {
  organizationId: number;
  userId: number;
  companyPeopleAdmin: boolean;
}) {
  return db.select({
    task: hcmLifecycleNotificationTasks,
    employeeNo: employees.employeeNo,
    employeeFirstName: employees.firstName,
    employeeLastName: employees.lastName,
  })
    .from(hcmLifecycleNotificationTasks)
    .innerJoin(employees, and(
      eq(hcmLifecycleNotificationTasks.employeeId, employees.id),
      eq(hcmLifecycleNotificationTasks.organizationId, employees.organizationId),
    ))
    .where(and(
      eq(hcmLifecycleNotificationTasks.organizationId, input.organizationId),
      input.companyPeopleAdmin ? undefined : eq(hcmLifecycleNotificationTasks.ownerUserId, input.userId),
    ))
    .orderBy(desc(hcmLifecycleNotificationTasks.updatedAt), desc(hcmLifecycleNotificationTasks.id));
}

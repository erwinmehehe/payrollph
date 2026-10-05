import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, recognitionEvents } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const CATEGORIES = ["appreciation", "teamwork", "customer", "innovation", "leadership", "milestone"] as const;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;

  const [events, staff] = await Promise.all([
    db.select().from(recognitionEvents).where(and(
      eq(recognitionEvents.organizationId, organizationId),
      eq(recognitionEvents.visibleToEveryone, true),
    )).orderBy(desc(recognitionEvents.id)).limit(100),
    db.select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      title: employees.title,
      status: employees.status,
    }).from(employees).where(eq(employees.organizationId, organizationId)),
  ]);
  const employeeById = new Map(staff.map((employee) => [employee.id, employee]));

  return Response.json({
    currentEmployeeId: user.employeeId ?? null,
    employees: staff.filter((employee) => employee.status === "Active"),
    recognition: events.map((event) => ({
      id: event.id,
      senderEmployeeId: event.senderEmployeeId,
      senderName: event.senderEmployeeId ? (() => {
        const employee = employeeById.get(event.senderEmployeeId);
        return employee ? employee.firstName + " " + employee.lastName : "Former employee";
      })() : "Company",
      recipientEmployeeId: event.recipientEmployeeId,
      recipientName: (() => {
        const employee = employeeById.get(event.recipientEmployeeId);
        return employee ? employee.firstName + " " + employee.lastName : "Employee";
      })(),
      category: event.category,
      message: event.message,
      createdAt: event.createdAt,
    })),
    categories: CATEGORIES,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const recipientEmployeeId = Number(body.recipientEmployeeId);
  const category = String(body.category ?? "appreciation");
  const message = String(body.message ?? "").trim();

  if (!Number.isInteger(organizationId) || !Number.isInteger(recipientEmployeeId)) {
    return Response.json({ error: "organizationId and recipientEmployeeId are required." }, { status: 400 });
  }
  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;
  if (!user.employeeId) return Response.json({ error: "A linked employee profile is required to give peer recognition." }, { status: 403 });
  if (user.employeeId === recipientEmployeeId) return Response.json({ error: "Peer recognition must be given to another employee." }, { status: 400 });
  if (!(CATEGORIES as readonly string[]).includes(category) || !message || message.length > 800) {
    return Response.json({ error: "Choose a valid recognition category and enter a message up to 800 characters." }, { status: 400 });
  }

  const [[sender], [recipient]] = await Promise.all([
    db.select().from(employees).where(and(
      eq(employees.id, user.employeeId),
      eq(employees.organizationId, organizationId),
      eq(employees.status, "Active"),
    )).limit(1),
    db.select().from(employees).where(and(
      eq(employees.id, recipientEmployeeId),
      eq(employees.organizationId, organizationId),
      eq(employees.status, "Active"),
    )).limit(1),
  ]);
  if (!sender || !recipient) return Response.json({ error: "Recognition sender or recipient is not an active employee in this workspace." }, { status: 404 });

  const [row] = await db.insert(recognitionEvents).values({
    organizationId,
    senderEmployeeId: sender.id,
    recipientEmployeeId: recipient.id,
    category,
    message,
    visibleToEveryone: true,
    createdByUserId: user.id,
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Peer recognition shared",
    resource: recipient.firstName + " " + recipient.lastName,
    metadata: { recognitionId: row.id, senderEmployeeId: sender.id, recipientEmployeeId: recipient.id, category },
  });

  return Response.json(row, { status: 201 });
}

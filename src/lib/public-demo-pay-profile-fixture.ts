/**
 * Explicit fixture values for the isolated hosted public demo only.
 * Never infer or backfill pay for an arbitrary employer's staff.
 */
export type PublicDemoProfileEmployee = Readonly<{
  id: number;
  organizationId: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
  email: string | null;
  basicRate: string;
}>;

type FictionalPerson = Readonly<{
  firstName: string;
  lastName: string;
  basicRate: string;
}>;

export type PublicDemoPayProfile = Readonly<{
  employeeId: number;
  organizationId: number;
  payBasis: "monthly";
  rateAmount: string;
  standardWorkDaysPerMonth: string;
  standardHoursPerDay: string;
}>;

const unverified = () => new Error("PUBLIC_DEMO_PAY_PROFILE_ROSTER_UNVERIFIED");

/** Exactly the eight original fictional workers, never other employees or employers. */
export function verifiedFictionalPayProfileRows(
  organizationId: number,
  staff: readonly PublicDemoProfileEmployee[],
  people: readonly FictionalPerson[],
): PublicDemoPayProfile[] {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      people.length !== 8 || staff.length !== 8) throw unverified();

  const byEmployeeNo = new Map(staff.map(worker => [worker.employeeNo, worker]));
  const byId = new Set(staff.map(worker => worker.id));
  if (byEmployeeNo.size !== 8 || byId.size !== 8) throw unverified();

  return people.map((person, index) => {
    const number = "LL-" + String(index + 101).padStart(3, "0");
    const row = byEmployeeNo.get(number);
    const expectedEmail = (person.firstName + "." + person.lastName)
      .toLowerCase().replace(/[^a-z.]/g, "") + "@linaw.ph";
    if (!row || !Number.isSafeInteger(row.id) || row.id <= 0 ||
        row.organizationId !== organizationId ||
        row.firstName !== person.firstName || row.lastName !== person.lastName ||
        row.email !== expectedEmail || row.basicRate !== person.basicRate ||
        !/^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(person.basicRate) ||
        Number(person.basicRate) <= 0) throw unverified();

    return {
      employeeId: row.id,
      organizationId,
      payBasis: "monthly",
      rateAmount: person.basicRate,
      standardWorkDaysPerMonth: "22",
      standardHoursPerDay: "8",
    };
  });
}

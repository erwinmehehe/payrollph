import { nominalRemittanceDueDate, type StatutoryAgency } from "@/lib/statutory-remittance";

export type ComplianceCalendarAgency = "BIR" | StatutoryAgency;
export type ComplianceCalendarStatus =
  | "complete"
  | "upcoming"
  | "due-soon"
  | "overdue"
  | "posting-pending"
  | "exception"
  | "verification-required"
  | "configuration-required";

export type ComplianceCalendarItem = {
  id: string;
  agency: ComplianceCalendarAgency;
  obligation: string;
  applicableMonth: string;
  dueDate: string | null;
  status: ComplianceCalendarStatus;
  detail: string;
  sourceLabel: string;
  sourceUrl: string;
  exactness: "nominal" | "conservative-target";
};

export type CalendarBatch = {
  agency: string;
  applicableMonth: string;
  dueDate: string;
  status: string;
  pendingPostingCount: number;
  exceptionCount: number;
};

const SOURCES = {
  BIR: {
    label: "BIR tax reminder / Form 1601-C instructions",
    url: "https://www.bir.gov.ph/Tax-Reminder",
  },
  SSS: {
    label: "SSS contribution payment deadlines",
    url: "https://www.sss.gov.ph/pay-contribution/",
  },
  PhilHealth: {
    label: "PhilHealth employer payment and reporting procedures",
    url: "https://www.philhealth.gov.ph/partners/employers/pay_procedures.php",
  },
  "Pag-IBIG": {
    label: "Pag-IBIG employer contribution and remittance guidelines",
    url: "https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/HDMF%20Circular%20275%20-%20Implementing%20Guidelines%20on%20Employer%20Registration%20Contribution%20and%20Remittance.pdf",
  },
} as const;

function dayNumber(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function daysUntil(dueDate: string, today: string) {
  return dayNumber(dueDate) - dayNumber(today);
}

function nextMonthDate(applicableMonth: string, day: number) {
  const [year, month] = applicableMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function nominalBir1601CDueDate(applicableMonth: string) {
  if (!/^\d{4}-\d{2}$/.test(applicableMonth)) {
    throw new Error("applicableMonth must use YYYY-MM.");
  }
  const month = Number(applicableMonth.slice(5, 7));
  return nextMonthDate(applicableMonth, month === 12 ? 15 : 10);
}

function timeStatus(dueDate: string, today: string): "upcoming" | "due-soon" | "overdue" {
  const days = daysUntil(dueDate, today);
  if (days < 0) return "overdue";
  if (days <= 7) return "due-soon";
  return "upcoming";
}

function remittanceItem(input: {
  agency: StatutoryAgency;
  applicableMonth: string;
  today: string;
  currentMonth: string;
  legalName: string;
  philHealthEmployerNo?: string | null;
  batch?: CalendarBatch | null;
}): ComplianceCalendarItem {
  const source = SOURCES[input.agency];
  let nominalDueDate: string | null = null;
  try {
    nominalDueDate = nominalRemittanceDueDate({
      agency: input.agency,
      applicableMonth: input.applicableMonth,
      legalName: input.legalName,
      philHealthEmployerNo: input.philHealthEmployerNo,
    });
  } catch {
    nominalDueDate = null;
  }

  if (!nominalDueDate) {
    return {
      id: `${input.agency}-${input.applicableMonth}`,
      agency: input.agency,
      obligation: `${input.agency} employer contribution remittance`,
      applicableMonth: input.applicableMonth,
      dueDate: null,
      status: "configuration-required",
      detail:
        input.agency === "PhilHealth"
          ? "Add the PhilHealth Employer Number so Linaw can resolve the PEN-based remittance window."
          : "Employer data is incomplete, so Linaw will not guess the remittance deadline.",
      sourceLabel: source.label,
      sourceUrl: source.url,
      exactness: "nominal",
    };
  }

  const batch = input.batch;
  if (batch) {
    if (batch.status === "reconciled") {
      return {
        id: `${input.agency}-${input.applicableMonth}`,
        agency: input.agency,
        obligation: `${input.agency} employer contribution remittance`,
        applicableMonth: input.applicableMonth,
        dueDate: batch.dueDate || nominalDueDate,
        status: "complete",
        detail: "Payment evidence and employee-level agency posting are reconciled for this month.",
        sourceLabel: source.label,
        sourceUrl: source.url,
        exactness: "nominal",
      };
    }

    if (batch.status === "exception" || batch.exceptionCount > 0) {
      return {
        id: `${input.agency}-${input.applicableMonth}`,
        agency: input.agency,
        obligation: `${input.agency} employer contribution remittance`,
        applicableMonth: input.applicableMonth,
        dueDate: batch.dueDate || nominalDueDate,
        status: "exception",
        detail: `${batch.exceptionCount} employee posting exception${batch.exceptionCount === 1 ? "" : "s"} remain unresolved.`,
        sourceLabel: source.label,
        sourceUrl: source.url,
        exactness: "nominal",
      };
    }

    if (batch.status === "paid" && batch.pendingPostingCount > 0) {
      return {
        id: `${input.agency}-${input.applicableMonth}`,
        agency: input.agency,
        obligation: `${input.agency} employer contribution remittance`,
        applicableMonth: input.applicableMonth,
        dueDate: batch.dueDate || nominalDueDate,
        status: "posting-pending",
        detail: `Payment is recorded, but ${batch.pendingPostingCount} employee posting confirmation${batch.pendingPostingCount === 1 ? "" : "s"} remain.`,
        sourceLabel: source.label,
        sourceUrl: source.url,
        exactness: "nominal",
      };
    }

    const timed = timeStatus(batch.dueDate || nominalDueDate, input.today);
    return {
      id: `${input.agency}-${input.applicableMonth}`,
      agency: input.agency,
      obligation: `${input.agency} employer contribution remittance`,
      applicableMonth: input.applicableMonth,
      dueDate: batch.dueDate || nominalDueDate,
      status: timed,
      detail:
        timed === "overdue"
          ? "The remittance batch is still open and payment evidence has not been recorded."
          : "The remittance liability is open. Record payment evidence, then reconcile employee posting.",
      sourceLabel: source.label,
      sourceUrl: source.url,
      exactness: "nominal",
    };
  }

  const timed = timeStatus(nominalDueDate, input.today);
  const closed = input.applicableMonth < input.currentMonth;
  return {
    id: `${input.agency}-${input.applicableMonth}`,
    agency: input.agency,
    obligation: `${input.agency} employer contribution remittance`,
    applicableMonth: input.applicableMonth,
    dueDate: nominalDueDate,
    status: closed ? timed : timed === "overdue" ? "due-soon" : timed,
    detail: closed
      ? timed === "overdue"
        ? "Payroll exists for this month, but no remittance control has been opened. Open the batch and reconcile immediately."
        : "Payroll exists for this closed month, but the remittance control has not been opened yet."
      : "This payroll month is still open. The calendar shows the next nominal remittance date so the team can prepare early.",
    sourceLabel: source.label,
    sourceUrl: source.url,
    exactness: "nominal",
  };
}

const ANNUAL_BIR_OBLIGATIONS = [
  {
    key: "2316-EMPLOYEE",
    obligation: "BIR Form 2316 issued to every employee",
    dueMonthDay: "01-31",
    detail: "Furnish each employee a signed Certificate of Compensation Payment/Tax Withheld for the tax year.",
  },
  {
    key: "1604C",
    obligation: "BIR Form 1604-C annual information return with alphalist",
    dueMonthDay: "01-31",
    detail: "File the annual withholding information return and employee alphalist. Validate the alphalist with the BIR validation module before submission.",
  },
  {
    key: "2316-BIR",
    obligation: "Signed BIR Form 2316 copies submitted to BIR",
    dueMonthDay: "02-28",
    detail: "Submit the duly signed 2316 copies (substituted filing) to the BIR office or channel that applies to the employer.",
  },
] as const;

/**
 * Annual BIR compensation obligations for a tax year, shown from November of
 * the tax year through April of the following year so they surface early
 * without cluttering the rest of the calendar.
 */
export function annualBirItems(taxYear: number, today: string): ComplianceCalendarItem[] {
  const windowStart = `${taxYear}-11-01`;
  const windowEnd = `${taxYear + 1}-04-30`;
  if (today < windowStart || today > windowEnd) return [];

  return ANNUAL_BIR_OBLIGATIONS.map((item) => {
    const dueDate = `${taxYear + 1}-${item.dueMonthDay}`;
    const timed = timeStatus(dueDate, today);
    return {
      id: `BIR-${item.key}-${taxYear}`,
      agency: "BIR" as const,
      obligation: item.obligation,
      applicableMonth: `${taxYear}-12`,
      dueDate,
      status: timed === "overdue" ? "verification-required" as const : timed,
      detail: timed === "overdue"
        ? `${item.detail} The nominal date has passed; verify the filing externally and retain the official evidence.`
        : `${item.detail} Nominal date for tax year ${taxYear}; a weekend or holiday can move the final date.`,
      sourceLabel: SOURCES.BIR.label,
      sourceUrl: SOURCES.BIR.url,
      exactness: "nominal" as const,
    };
  });
}

export function buildComplianceCalendar(input: {
  today: string;
  currentMonth: string;
  applicableMonths: string[];
  birApplicableMonths?: string[];
  legalName: string;
  philHealthEmployerNo?: string | null;
  batches: CalendarBatch[];
  bir1601cOperationalMonths?: string[];
  annualTaxYears?: number[];
}) {
  const byKey = new Map(input.batches.map((batch) => [`${batch.applicableMonth}|${batch.agency}`, batch]));
  const birOperationalMonths = new Set(input.bir1601cOperationalMonths ?? []);
  const items: ComplianceCalendarItem[] = [];

  for (const applicableMonth of input.birApplicableMonths ?? input.applicableMonths) {
    const birDue = nominalBir1601CDueDate(applicableMonth);
    const birTime = timeStatus(birDue, input.today);
    const birOperationallyProven = birOperationalMonths.has(applicableMonth);
    items.push({
      id: `BIR-1601C-${applicableMonth}`,
      agency: "BIR",
      obligation: "BIR Form 1601-C withholding remittance",
      applicableMonth,
      dueDate: birDue,
      status: birOperationallyProven
        ? "complete"
        : birTime === "overdue"
          ? "verification-required"
          : birTime,
      detail: birOperationallyProven
        ? "A current-version BIR 1601-C filing acknowledgement is recorded for this payroll pay month. This proves the operational filing, not that PayrollPH produced an official BIR upload file."
        : birTime === "overdue"
          ? "PayrollPH does not yet hold authoritative monthly BIR filing acknowledgement for this pay month. Verify the filed return/payment externally and retain the official evidence."
          : "Conservative internal target based on the non-eFPS 1601-C deadline. eFPS filing/payment dates vary by filer group, so confirm the published BIR calendar for the taxpayer.",
      sourceLabel: SOURCES.BIR.label,
      sourceUrl: SOURCES.BIR.url,
      exactness: "conservative-target",
    });
  }

  const taxYears = new Set(
    input.annualTaxYears
      ?? (input.birApplicableMonths ?? input.applicableMonths).map((month) => Number(month.slice(0, 4))),
  );
  for (const taxYear of [...taxYears].sort()) {
    items.push(...annualBirItems(taxYear, input.today));
  }

  for (const applicableMonth of input.applicableMonths) {
    for (const agency of ["SSS", "PhilHealth", "Pag-IBIG"] as const) {
      items.push(remittanceItem({
        agency,
        applicableMonth,
        today: input.today,
        currentMonth: input.currentMonth,
        legalName: input.legalName,
        philHealthEmployerNo: input.philHealthEmployerNo,
        batch: byKey.get(`${applicableMonth}|${agency}`) ?? null,
      }));
    }
  }

  const rank: Record<ComplianceCalendarStatus, number> = {
    overdue: 0,
    exception: 1,
    "configuration-required": 2,
    "verification-required": 3,
    "posting-pending": 4,
    "due-soon": 5,
    upcoming: 6,
    complete: 7,
  };

  return items.sort((a, b) =>
    rank[a.status] - rank[b.status]
    || String(a.dueDate ?? "9999-99-99").localeCompare(String(b.dueDate ?? "9999-99-99"))
    || a.id.localeCompare(b.id),
  );
}

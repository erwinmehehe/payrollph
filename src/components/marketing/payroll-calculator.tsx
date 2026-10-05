"use client";

import { useMemo, useState } from "react";
import {
  computeMonthlyWithholdingTax,
  computePagIbig,
  computePhilHealth,
  computeSss,
  holidayMultiplier,
} from "@/lib/payroll-rules";
import { computeThirteenthMonthPay } from "@/lib/ph-compliance";
import type { CalculatorSlug } from "@/lib/calculators";

function money(value: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value || 0);
}

export function PayrollCalculator({ slug }: { slug: CalculatorSlug }) {
  const [amount, setAmount] = useState(30000);
  const [hours, setHours] = useState(2);
  const [dayType, setDayType] = useState<"ordinary" | "regular" | "special">("ordinary");
  const [restDay, setRestDay] = useState(false);
  const [mwe, setMwe] = useState(false);

  const result = useMemo(() => {
    if (slug === "13th-month-pay") return { label: "Estimated 13th-month pay", value: computeThirteenthMonthPay(amount) };
    if (slug === "sss-contribution") {
      const v = computeSss(amount);
      return { label: "Employee contribution", value: v.employee, details: [`Employer: ${money(v.employer)}`, `EC: ${money(v.employerEC)}`, `Total: ${money(v.total)}`] };
    }
    if (slug === "philhealth-contribution") {
      const v = computePhilHealth(amount);
      return { label: "Employee share", value: v.employee, details: [`Employer: ${money(v.employer)}`, `Total premium: ${money(v.total)}`] };
    }
    if (slug === "pag-ibig-contribution") {
      const v = computePagIbig(amount);
      return { label: "Employee contribution", value: v.employee, details: [`Employer: ${money(v.employer)}`, `Total: ${money(v.total)}`] };
    }
    if (slug === "withholding-tax") return { label: "Estimated monthly withholding", value: computeMonthlyWithholdingTax(amount, mwe) };

    const hourlyRate = amount;
    if (slug === "overtime-pay") {
      const multiplier = holidayMultiplier({ holiday: dayType, worked: true, restDay, overtime: true });
      return { label: "Estimated overtime pay", value: hourlyRate * hours * multiplier, details: [`Applied multiplier: ×${multiplier}`] };
    }
    const baseMultiplier = holidayMultiplier({ holiday: dayType, worked: true, restDay, overtime: false });
    return { label: "Estimated night differential", value: hourlyRate * hours * baseMultiplier * 0.1, details: [`Base day multiplier: ×${baseMultiplier}`, "Night differential factor: 10%"] };
  }, [amount, hours, dayType, restDay, mwe, slug]);

  const label = slug === "13th-month-pay"
    ? "Total basic salary earned during the year"
    : slug === "withholding-tax"
      ? "Monthly taxable compensation"
      : slug === "overtime-pay" || slug === "night-differential"
        ? "Hourly rate"
        : "Monthly salary";

  const showHours = slug === "overtime-pay" || slug === "night-differential";
  const showMwe = slug === "withholding-tax";

  return (
    <div className="grid gap-6 rounded-[28px] border border-[#E2E4F0] bg-white p-6 shadow-sm lg:grid-cols-[1fr_.9fr]">
      <div className="grid gap-5">
        <label className="grid gap-2 text-[13px] font-semibold text-[#34394F]">
          {label}
          <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="rounded-xl border border-[#DDE0EB] px-4 py-3 text-[15px]" />
        </label>
        {showHours ? (
          <>
            <label className="grid gap-2 text-[13px] font-semibold text-[#34394F]">
              Hours
              <input type="number" min="0" step="0.25" value={hours} onChange={(e) => setHours(Number(e.target.value))} className="rounded-xl border border-[#DDE0EB] px-4 py-3 text-[15px]" />
            </label>
            <label className="grid gap-2 text-[13px] font-semibold text-[#34394F]">
              Work day type
              <select value={dayType} onChange={(e) => setDayType(e.target.value as typeof dayType)} className="rounded-xl border border-[#DDE0EB] px-4 py-3 text-[15px]">
                <option value="ordinary">Ordinary day</option>
                <option value="special">Special non-working day</option>
                <option value="regular">Regular holiday</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-[13px] font-medium text-[#34394F]">
              <input type="checkbox" checked={restDay} onChange={(e) => setRestDay(e.target.checked)} />
              This is also the employee's rest day
            </label>
          </>
        ) : null}
        {showMwe ? (
          <label className="flex items-center gap-2 text-[13px] font-medium text-[#34394F]">
            <input type="checkbox" checked={mwe} onChange={(e) => setMwe(e.target.checked)} />
            Treat as a minimum-wage earner for this estimate
          </label>
        ) : null}
      </div>
      <div className="rounded-[22px] bg-[#11141F] p-6 text-white">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">{result.label}</p>
        <p className="mt-3 text-[38px] font-semibold tracking-[-0.04em]">{money(result.value)}</p>
        {result.details?.map((item) => <p key={item} className="mt-2 text-[13px] text-white/65">{item}</p>)}
        <p className="mt-6 text-[11.5px] leading-relaxed text-white/45">
          Educational estimate only. Actual payroll treatment depends on employee classification, complete payroll inputs, effective rules and employer-specific circumstances. Verify current requirements before release or filing.
        </p>
      </div>
    </div>
  );
}

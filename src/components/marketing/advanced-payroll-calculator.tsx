"use client";

import { useMemo, useState } from "react";
import type { AdvancedCalculatorSlug } from "@/lib/calculators";

function money(value: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number.isFinite(value) ? value : 0);
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-2 text-[13px] font-semibold text-[#34394F]">
      {label}
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="rounded-xl border border-[#DDE0EB] px-4 py-3 text-[15px]"
      />
    </label>
  );
}

export function AdvancedPayrollCalculator({ slug }: { slug: AdvancedCalculatorSlug }) {
  const [monthlySalary, setMonthlySalary] = useState(30000);
  const [divisor, setDivisor] = useState(26);
  const [hoursPerDay, setHoursPerDay] = useState(8);

  const [unpaidSalary, setUnpaidSalary] = useState(20000);
  const [thirteenthMonth, setThirteenthMonth] = useState(5000);
  const [leaveConversion, setLeaveConversion] = useState(0);
  const [separationOrRetirement, setSeparationOrRetirement] = useState(0);
  const [taxRefund, setTaxRefund] = useState(0);
  const [otherAmounts, setOtherAmounts] = useState(0);
  const [authorizedDeductions, setAuthorizedDeductions] = useState(0);

  const [processingHours, setProcessingHours] = useState(40);
  const [reworkHours, setReworkHours] = useState(10);
  const [loadedHourlyCost, setLoadedHourlyCost] = useState(500);
  const [serviceCost, setServiceCost] = useState(15000);

  const result = useMemo(() => {
    if (slug === "final-pay") {
      const grossKnownComponents =
        unpaidSalary +
        thirteenthMonth +
        leaveConversion +
        separationOrRetirement +
        taxRefund +
        otherAmounts;
      return {
        label: "Estimated final-pay subtotal",
        value: Math.max(0, grossKnownComponents - authorizedDeductions),
        details: [
          `Known positive components: ${money(grossKnownComponents)}`,
          `Authorized deductions entered: ${money(authorizedDeductions)}`,
        ],
      };
    }

    if (slug === "daily-rate") {
      const dailyRate = divisor > 0 ? monthlySalary / divisor : 0;
      return {
        label: "Estimated daily rate",
        value: dailyRate,
        details: [`Monthly salary: ${money(monthlySalary)}`, `Divisor entered: ${divisor}`],
      };
    }

    if (slug === "hourly-rate") {
      const dailyRate = divisor > 0 ? monthlySalary / divisor : 0;
      const hourlyRate = hoursPerDay > 0 ? dailyRate / hoursPerDay : 0;
      return {
        label: "Estimated hourly rate",
        value: hourlyRate,
        details: [`Estimated daily rate: ${money(dailyRate)}`, `Hours per day entered: ${hoursPerDay}`],
      };
    }

    const internalMonthlyCost = (processingHours + reworkHours) * loadedHourlyCost;
    const monthlyDifference = internalMonthlyCost - serviceCost;
    return {
      label: monthlyDifference >= 0 ? "Estimated monthly cost reduction" : "Estimated monthly cost increase",
      value: Math.abs(monthlyDifference),
      details: [
        `Estimated internal monthly labor cost: ${money(internalMonthlyCost)}`,
        `Managed service cost entered: ${money(serviceCost)}`,
        `Estimated annual difference: ${money(Math.abs(monthlyDifference) * 12)}`,
      ],
    };
  }, [
    slug,
    monthlySalary,
    divisor,
    hoursPerDay,
    unpaidSalary,
    thirteenthMonth,
    leaveConversion,
    separationOrRetirement,
    taxRefund,
    otherAmounts,
    authorizedDeductions,
    processingHours,
    reworkHours,
    loadedHourlyCost,
    serviceCost,
  ]);

  return (
    <div className="grid gap-6 rounded-[28px] border border-[#E2E4F0] bg-white p-6 shadow-sm lg:grid-cols-[1fr_.9fr]">
      <div className="grid gap-5">
        {slug === "final-pay" ? (
          <>
            <NumberField label="Unpaid salary / wages" value={unpaidSalary} onChange={setUnpaidSalary} />
            <NumberField label="Prorated 13th-month amount" value={thirteenthMonth} onChange={setThirteenthMonth} />
            <NumberField label="Unused leave cash value, if applicable" value={leaveConversion} onChange={setLeaveConversion} />
            <NumberField label="Separation / retirement pay, if approved" value={separationOrRetirement} onChange={setSeparationOrRetirement} />
            <NumberField label="Tax refund / adjustment" value={taxRefund} onChange={setTaxRefund} />
            <NumberField label="Other approved amounts" value={otherAmounts} onChange={setOtherAmounts} />
            <NumberField label="Authorized deductions" value={authorizedDeductions} onChange={setAuthorizedDeductions} />
          </>
        ) : null}

        {slug === "daily-rate" || slug === "hourly-rate" ? (
          <>
            <NumberField label="Monthly salary" value={monthlySalary} onChange={setMonthlySalary} />
            <NumberField label="Payroll divisor" value={divisor} onChange={setDivisor} />
            {slug === "hourly-rate" ? <NumberField label="Paid hours per day" value={hoursPerDay} onChange={setHoursPerDay} /> : null}
          </>
        ) : null}

        {slug === "payroll-outsourcing-roi" ? (
          <>
            <NumberField label="Monthly payroll processing hours" value={processingHours} onChange={setProcessingHours} />
            <NumberField label="Monthly correction / rework hours" value={reworkHours} onChange={setReworkHours} />
            <NumberField label="Loaded internal hourly cost" value={loadedHourlyCost} onChange={setLoadedHourlyCost} />
            <NumberField label="Proposed managed payroll monthly cost" value={serviceCost} onChange={setServiceCost} />
          </>
        ) : null}
      </div>

      <div className="rounded-[22px] bg-[#11141F] p-6 text-white">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">{result.label}</p>
        <p className="mt-3 text-[38px] font-semibold tracking-[-0.04em]">{money(result.value)}</p>
        {result.details.map((item) => <p key={item} className="mt-2 text-[13px] text-white/65">{item}</p>)}
        <p className="mt-6 text-[11.5px] leading-relaxed text-white/45">
          Planning estimate only. The tool uses the values you enter and does not determine legal entitlement, the correct payroll divisor, tax treatment or guaranteed outsourcing savings.
        </p>
      </div>
    </div>
  );
}

export const fmt = (n: number) =>
  n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Monthly employee-share statutory estimate (illustrative 2025 tables). */
export function compute(monthly: number) {
  const msc = Math.min(35000, Math.max(5000, Math.round(monthly / 500) * 500));
  const sss = msc * 0.05;
  const ph = (Math.min(100000, Math.max(10000, monthly)) * 0.05) / 2;
  const hdmf = Math.min(monthly, 10000) * (monthly <= 1500 ? 0.01 : 0.02);
  const taxableAnnual = (monthly - sss - ph - hdmf) * 12;
  const b: [number, number, number][] = [
    [8000000, 2202500, 0.35],
    [2000000, 402500, 0.3],
    [800000, 102500, 0.25],
    [400000, 22500, 0.2],
    [250000, 0, 0.15],
  ];
  let tax = 0;
  for (const [floor, base, rate] of b)
    if (taxableAnnual > floor) {
      tax = base + (taxableAnnual - floor) * rate;
      break;
    }
  const wtax = tax / 12;
  return { msc, sss, ph, hdmf, wtax, net: monthly - sss - ph - hdmf - wtax };
}

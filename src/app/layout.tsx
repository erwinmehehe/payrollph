import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
});

// Fixed weights rather than `weight: "variable"` + `axes`: Turbopack's font
// query builder rejects multi-entry axis queries, which made every page fail to
// build. The serif voice survives intact; only the optional axes are dropped.
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Linaw — Philippine Payroll & HRIS, from freelancer to enterprise",
  description:
    "Run compliant Philippine payroll for one person or ten thousand. Automatic SSS, PhilHealth, Pag-IBIG, and BIR TRAIN computation, multi-client bookkeeping, and transparent published pricing.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-PH" className={`${inter.variable} ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  );
}

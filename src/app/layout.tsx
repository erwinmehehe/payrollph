import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
});

// The data face. Payroll is read as numbers before it is read as prose, so
// amounts, employee numbers, rule codes, trace lines and API output are all set
// in mono with tabular figures. Two weights only, this is not a display font.
// No explicit `weight`: Turbopack's font-query builder rejects a multi-entry
// weight list here (the same failure the serif face hit before it was removed),
// so the variable font is requested and the whole weight range stays available.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Linaw · Philippine Payroll & HRIS",
  description:
    "Run compliant Philippine payroll for one person or ten thousand. Automatic SSS, PhilHealth, Pag-IBIG, and BIR TRAIN computation, multi-client bookkeeping, and transparent published pricing.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-PH" className={`${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

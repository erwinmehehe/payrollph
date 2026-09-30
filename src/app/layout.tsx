import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./workspace-theme.css";

export const metadata: Metadata = {
  title: "Linaw · Philippine Payroll & HRIS",
  description:
    "Run compliant Philippine payroll for one person or ten thousand. Automatic SSS, PhilHealth, Pag-IBIG, and BIR TRAIN computation, multi-client bookkeeping, and transparent published pricing.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-PH">
      <body>{children}</body>
    </html>
  );
}

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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

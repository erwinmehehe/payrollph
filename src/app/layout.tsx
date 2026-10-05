import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PUBLIC_SITE_URL } from "@/lib/site-url";
import "./globals.css";
import "./workspace-theme.css";

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_SITE_URL),
  title: {
    default: "Linaw · Philippine Payroll Software",
    template: "%s",
  },
  description:
    "Run Philippine payroll with SSS, PhilHealth, Pag-IBIG and BIR TRAIN computation, approvals, role-based workflows, multi-client bookkeeping and traceable payroll outputs.",
  openGraph: {
    type: "website",
    locale: "en_PH",
    siteName: "Linaw",
    title: "Linaw · Philippine Payroll Software",
    description:
      "Philippine payroll software with role-based approvals, traceable calculations, employee payslips and controlled payroll outputs.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Linaw Philippine payroll software" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Linaw · Philippine Payroll Software",
    description:
      "Philippine payroll software with role-based approvals, traceable calculations and controlled payroll outputs.",
    images: ["/opengraph-image"],
  },
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

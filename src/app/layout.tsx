import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import { PUBLIC_SITE_URL } from "@/lib/site-url";
import { MarketingAttributionCapture } from "@/components/marketing/marketing-attribution-capture";
import "./globals.css";
import "./workspace-theme.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetBrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

const googleSiteVerification = process.env.GOOGLE_SITE_VERIFICATION?.trim();
const bingSiteVerification = process.env.BING_SITE_VERIFICATION?.trim();

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
  ...(googleSiteVerification || bingSiteVerification
    ? {
        verification: {
          ...(googleSiteVerification ? { google: googleSiteVerification } : {}),
          ...(bingSiteVerification ? { other: { "msvalidate.01": bingSiteVerification } } : {}),
        },
      }
    : {}),
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
    <html lang="en-PH" className={`${inter.variable} ${jetBrainsMono.variable}`}>
      <body><MarketingAttributionCapture />{children}</body>
    </html>
  );
}

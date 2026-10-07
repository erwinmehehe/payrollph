"use client";

import Navbar from "./components/Navbar";
import { ProductHomeHero } from "../product-home-hero";
import { ProductHomeStories } from "../product-home-stories";
import Demo from "./components/Demo";
import Pricing from "./components/Pricing";
import { CTA, FAQ, Footer } from "./components/Closing";

export type PublicPlan = {
  id: number;
  name: string;
  monthlyBase: string;
  perEmployee: string;
  modules: unknown;
  version: string;
  active?: boolean;
};

export default function ClaudeHomepage({ plans }: { plans: PublicPlan[] }) {
  return (
    <div className="home-redesign min-h-screen bg-white text-[#0B0D1A]">
      <Navbar />
      <main id="main">
        <ProductHomeHero />
        <ProductHomeStories />
        <details className="lp-demo-disclosure">
          <summary>Try the interactive payroll workflow</summary>
          <Demo />
        </details>
        <Pricing plans={plans} />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

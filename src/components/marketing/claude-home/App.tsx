"use client";

import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import Demo from "./components/Demo";
import { Calculator } from "./components/Product";
import { PayrollWorkflow, Security } from "./components/Trust";
import Pricing from "./components/Pricing";
import { FAQ, Footer } from "./components/Closing";
import {
  SolutionsGrid, PayrollShowcase, WorkforceShowcase, HcmShowcase,
  OutsourcingShowcase, PhilippineCompliance, PlatformFinalCTA,
} from "./components/PlatformSections";

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
        <Hero />
        <SolutionsGrid />
        <PayrollShowcase />
        <WorkforceShowcase />
        <HcmShowcase />
        <OutsourcingShowcase />
        <PhilippineCompliance />
        <PayrollWorkflow />
        <Demo />
        <Security />
        <Pricing plans={plans} />
        <Calculator />
        <FAQ />
        <PlatformFinalCTA />
      </main>
      <Footer />
    </div>
  );
}

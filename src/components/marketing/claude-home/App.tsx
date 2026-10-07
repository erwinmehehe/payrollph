"use client";

import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import Demo from "./components/Demo";
import { PayrollWorkflow, Security } from "./components/Trust";
import Pricing from "./components/Pricing";
import { FAQ, Footer } from "./components/Closing";
import {
  SolutionsGrid, PhilippineCompliance, PlatformFinalCTA,
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
        <Demo />
        <PhilippineCompliance />
        <PayrollWorkflow />
        <Security />
        <Pricing plans={plans} />
        <FAQ />
        <PlatformFinalCTA />
      </main>
      <Footer />
    </div>
  );
}

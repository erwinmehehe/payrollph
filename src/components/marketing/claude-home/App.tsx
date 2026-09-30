"use client";

import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import Demo from "./components/Demo";
import { Benchmarks, Calculator, Exports, TrustStrip } from "./components/Product";
import { Audiences, Developers, Scorecard, Security } from "./components/Trust";
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
        <Hero />
        <TrustStrip />
        <Audiences />
        <Demo />
        <Calculator />
        <Benchmarks />
        <Exports />
        <Security />
        <Scorecard />
        <Developers />
        <Pricing plans={plans} />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

"use client";

import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import Demo from "./components/Demo";
import { Benchmarks, Calculator, Exports, TrustStrip } from "./components/Product";
import { Audiences, Developers, Scorecard, Security } from "./components/Trust";
import Pricing from "./components/Pricing";
import { CTA, FAQ, Footer } from "./components/Closing";

export default function ClaudeHomepage() {
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
        <Pricing />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

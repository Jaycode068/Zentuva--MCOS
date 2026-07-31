import { AiSection } from '@/components/marketing/ai-section';
import { CtaSection } from '@/components/marketing/cta-section';
import { Footer } from '@/components/marketing/footer';
import { Hero } from '@/components/marketing/hero';
import { Navbar } from '@/components/marketing/navbar';
import { PlatformModules } from '@/components/marketing/platform-modules';
import { ProblemSection } from '@/components/marketing/problem-section';
import { RetailIntelligence } from '@/components/marketing/retail-intelligence';
import { TrustedBy } from '@/components/marketing/trusted-by';
import { VisionTimeline } from '@/components/marketing/vision-timeline';
import { WhatIsZentuva } from '@/components/marketing/what-is-zentuva';
import { WhyZentuva } from '@/components/marketing/why-zentuva';

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <TrustedBy />
        <ProblemSection />
        <WhatIsZentuva />
        <PlatformModules />
        <WhyZentuva />
        <RetailIntelligence />
        <AiSection />
        <VisionTimeline />
        <CtaSection />
      </main>
      <Footer />
    </>
  );
}

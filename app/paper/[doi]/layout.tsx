import { ReactNode } from "react";

import { PaperHero } from "@/components/paper-hero";
import { PaperTabNav } from "@/components/paper-tab-nav";
import { StatusBanner } from "@/components/status-banner";
import { samplePaper } from "@/lib/mock-data";

interface PaperLayoutProps {
  children: ReactNode;
  params: { doi: string };
}

export default function PaperLayout({ children }: PaperLayoutProps) {
  const paper = samplePaper;

  return (
    <div className="space-y-8 pb-16">
      <StatusBanner />
      <PaperHero paper={paper} />
      <PaperTabNav activeTab="paper" onTabChange={undefined} />
      <div className="grid gap-6">{children}</div>
    </div>
  );
}

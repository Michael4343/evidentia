import { ReactNode } from "react";
import { PaperHero } from "@/components/paper-hero";
import { PaperTabNav } from "@/components/paper-tab-nav";
import { StatusBanner } from "@/components/status-banner";

interface PaperLayoutProps {
  children: ReactNode;
  params: { doi: string };
}

export default function PaperLayout({ children, params }: PaperLayoutProps) {
  return (
    <div className="space-y-8 pb-16">
      <StatusBanner />
      <PaperHero />
      <PaperTabNav doi={params.doi} />
      <div className="grid gap-6">{children}</div>
    </div>
  );
}

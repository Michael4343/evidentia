import { ReactNode } from "react";

import { PaperReaderHeader } from "@/components/paper-reader-header";
import { samplePaper } from "@/lib/mock-data";

interface PaperLayoutProps {
  children: ReactNode;
  params: { doi: string };
}

export default function PaperLayout({ children }: PaperLayoutProps) {
  const paper = samplePaper;

  return (
    <div className="space-y-8 pb-16">
      <PaperReaderHeader paper={paper} activeTab="paper" />
      <div className="grid gap-6">{children}</div>
    </div>
  );
}

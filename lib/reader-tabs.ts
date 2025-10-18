export type ReaderTabKey = "paper" | "similarPapers" | "patents" | "theses" | "experts";

export const readerTabs: Array<{ key: ReaderTabKey; label: string }> = [
  { key: "paper", label: "Paper" },
  { key: "similarPapers", label: "Similar Papers" },
  { key: "patents", label: "Patents" },
  { key: "theses", label: "PhD Theses" },
  { key: "experts", label: "Expert Network" }
];

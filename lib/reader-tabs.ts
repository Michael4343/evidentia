export type ReaderTabKey =
  | "paper"
  | "claims"
  | "similarPapers"
  | "patents"
  | "theses"
  | "experts"
  | "researchGroups";

export const readerTabs: Array<{ key: ReaderTabKey; label: string }> = [
  { key: "paper", label: "Paper" },
  { key: "claims", label: "Claims" },
  { key: "similarPapers", label: "Similar Papers" },
  { key: "researchGroups", label: "Research Groups" },
  { key: "theses", label: "PhD Theses" },
  { key: "patents", label: "Patents" },
  { key: "experts", label: "Expert Network" }
];

export type ReaderTabKey = "paper" | "similarPapers" | "patents" | "theses" | "experts";

export interface PaperComment {
  id: string;
  author: string;
  text: string;
  page: number;
  timestamp: string;
}

export interface TabHighlightItem {
  title: string;
  description: string;
}

export interface PaperDetail {
  id: string;
  slug: string;
  title: string;
  doi: string;
  owner: string;
  uploadedAt: string;
  venue: string;
  year: number;
  status: string;
  authors: string[];
  abstract: string;
  tabSummaries: Partial<Record<Exclude<ReaderTabKey, "paper">, string>>;
  comments: PaperComment[];
  tabHighlights?: Partial<Record<Exclude<ReaderTabKey, "paper">, TabHighlightItem[]>>;
}

export interface PaperLibraryEntry {
  id: string;
  slug: string;
  title: string;
  doi: string;
  owner: string;
  uploadedAt: string;
  tabSummaries: Partial<Record<Exclude<ReaderTabKey, "paper">, string>>;
}

export const processingStages = [
  { key: "upload", label: "Uploading", description: "Receiving your PDF." },
  {
    key: "extract",
    label: "Extracting text",
    description: "Parsing the document and locating the DOI."
  },
  {
    key: "analyze",
    label: "Analysing with AI",
    description: "Summarising sections and identifying key concepts."
  },
  {
    key: "generate",
    label: "Generating interactive content",
    description: "Preparing highlights, figures, and navigation."
  },
  {
    key: "complete",
    label: "Complete",
    description: "Ready to explore."
  }
] as const;

const tabHighlightDefaults: Record<Exclude<ReaderTabKey, "paper">, TabHighlightItem[]> = {
  similarPapers: [
    {
      title: "Open-source reproducibility checks",
      description: "Gathering preprints that replicated the core architecture within the past 6 months."
    },
    {
      title: "Benchmark deltas",
      description: "Comparing datasets, metrics, and compute budgets side-by-side with peers."
    }
  ],
  patents: [
    {
      title: "Transformer distillation pipeline",
      description: "US-2025-11832 outlines a similar compression approach for edge inference."
    }
  ],
  theses: [
    {
      title: "Contrastive vision pre-training",
      description: "Doctoral work exploring sample efficiency under limited compute."
    }
  ],
  experts: [
    {
      title: "Dr. Lina Cheng",
      description: "Has audited 12 transformer-based pipelines across industry deployments."
    },
    {
      title: "Prof. Adewale Ige",
      description: "Focuses on responsible AI verification practices for research teams."
    }
  ]
};

export const mockPaperDetails: PaperDetail[] = [
  {
    id: "paper-1",
    slug: "self-supervised-vision-transformers",
    title: "Self-Supervised Vision Transformers",
    doi: "10.48550/arXiv.2403.01234",
    owner: "Evidentia Labs",
    uploadedAt: "3h ago",
    venue: "arXiv",
    year: 2025,
    status: "Ready",
    authors: ["Linnea Ortega", "Jamal Khatri", "Priya Nair"],
    abstract:
      "Vision transformers can learn robust representations via masked token prediction and contrastive distillation. The reader prototype surfaces the abstract for unauthenticated readers and gates the full PDF interactions behind sign-in.",
    tabSummaries: {
      similarPapers: "+4",
      patents: "+1",
      theses: "+2",
      experts: "+3"
    },
    comments: [
      {
        id: "c1",
        author: "You",
        text: "Flag the ablation on page 5 for verification once the expert network is live.",
        page: 5,
        timestamp: "Just now"
      },
      {
        id: "c2",
        author: "Hannah Lee",
        text: "Add context about dataset licensing before sharing externally.",
        page: 9,
        timestamp: "5m ago"
      }
    ],
    tabHighlights: {
      similarPapers: tabHighlightDefaults.similarPapers,
      patents: tabHighlightDefaults.patents,
      theses: tabHighlightDefaults.theses,
      experts: tabHighlightDefaults.experts
    }
  },
  {
    id: "paper-2",
    slug: "causal-eval-toolkit",
    title: "Causal Eval Toolkit for Generative Models",
    doi: "10.1145/1234567.890123",
    owner: "Verification Lab",
    uploadedAt: "1d ago",
    venue: "NeurIPS",
    year: 2024,
    status: "Processing",
    authors: ["Marcus Bell", "Sofia Mehta"],
    abstract:
      "A lightweight evaluation harness that scores generative model claims using causal interventions and dataset provenance checks.",
    tabSummaries: {
      similarPapers: "+6",
      patents: "Pending",
      theses: "+1",
      experts: "+2"
    },
    comments: [
      {
        id: "c3",
        author: "Marcus Bell",
        text: "Need to double-check the causal graph assumptions before sharing with partners.",
        page: 3,
        timestamp: "1h ago"
      }
    ],
    tabHighlights: {
      similarPapers: [
        {
          title: "Intervention-based benchmarks",
          description: "Compares claim verification pipelines that run intervention sets on synthetic data."
        }
      ],
      experts: [
        {
          title: "Dr. Helena Ortiz",
          description: "Leads the reproducibility task force for causal ML tooling."
        }
      ]
    }
  },
  {
    id: "paper-3",
    slug: "graph-agents-retrieval",
    title: "Graph Agents for Retrieval-Augmented Verification",
    doi: "10.1109/TKDE.2025.1234567",
    owner: "GraphLab",
    uploadedAt: "5d ago",
    venue: "IEEE TKDE",
    year: 2025,
    status: "Ready",
    authors: ["Allegra Sun", "Peter Holm", "Ravi Desai"],
    abstract:
      "Agents coordinate over a knowledge graph to resolve conflicting evidence when validating research claims across multiple corpora.",
    tabSummaries: {
      similarPapers: "+3",
      patents: "+2",
      theses: "+1",
      experts: "+4"
    },
    comments: [
      {
        id: "c4",
        author: "Peter Holm",
        text: "Surface the graph traversal animation in the next demo build.",
        page: 7,
        timestamp: "2d ago"
      },
      {
        id: "c5",
        author: "Verification Bot",
        text: "Queued verification of theorem 2.1 with external reviewers.",
        page: 12,
        timestamp: "3d ago"
      }
    ],
    tabHighlights: {
      patents: [
        {
          title: "Knowledge graph dispute resolver",
          description: "Patent application WO/2025/019876 cites a similar reasoning pipeline."
        }
      ],
      theses: [
        {
          title: "Collaborative graph search",
          description: "Thesis outlines distributed graph traversal for fact checking."
        }
      ]
    }
  }
];

export const mockPaperLibrary: PaperLibraryEntry[] = mockPaperDetails.map(
  ({ id, slug, title, doi, owner, uploadedAt, tabSummaries }) => ({
    id,
    slug,
    title,
    doi,
    owner,
    uploadedAt,
    tabSummaries
  })
);

export function getPaperDetail(slug: string): PaperDetail {
  return mockPaperDetails.find((paper) => paper.slug === slug) ?? mockPaperDetails[0];
}

export const samplePaper = mockPaperDetails[0];

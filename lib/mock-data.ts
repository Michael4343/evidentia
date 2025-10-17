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
      title: "Related research paper",
      description: "Description of how this paper connects to and builds upon existing research."
    },
    {
      title: "Comparative study",
      description: "Summary of research that uses similar methods or addresses related questions."
    }
  ],
  patents: [
    {
      title: "Related patent application",
      description: "Description of patent that references similar methods or applications."
    }
  ],
  theses: [
    {
      title: "Relevant doctoral research",
      description: "Summary of thesis work exploring related topics or methodologies."
    }
  ],
  experts: [
    {
      title: "Expert Researcher",
      description: "Description of relevant expertise and experience in this research area."
    },
    {
      title: "Domain Specialist",
      description: "Overview of the specialist's background and verification experience."
    }
  ]
};

export const mockPaperDetails: PaperDetail[] = [
  {
    id: "paper-1",
    slug: "sample-research-paper",
    title: "Sample Research Paper Title",
    doi: "10.1234/sample.doi.12345",
    owner: "Research Lab",
    uploadedAt: "Recently",
    venue: "Conference",
    year: 2025,
    status: "Ready",
    authors: ["Author One", "Author Two", "Author Three"],
    abstract:
      "This is a placeholder abstract that describes the research methodology, key findings, and contributions. The actual abstract content will be extracted from uploaded papers.",
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
        text: "Sample annotation comment about a specific section or claim.",
        page: 5,
        timestamp: "Just now"
      },
      {
        id: "c2",
        author: "Collaborator",
        text: "Example note from a team member about methodology or results.",
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
    slug: "another-sample-paper",
    title: "Another Sample Research Paper",
    doi: "10.1145/sample.67890",
    owner: "Research Lab",
    uploadedAt: "1d ago",
    venue: "Journal",
    year: 2024,
    status: "Processing",
    authors: ["Author A", "Author B"],
    abstract:
      "This placeholder represents a paper currently being processed. The abstract and metadata will be populated once analysis is complete.",
    tabSummaries: {
      similarPapers: "+6",
      patents: "Pending",
      theses: "+1",
      experts: "+2"
    },
    comments: [
      {
        id: "c3",
        author: "Team Member",
        text: "Sample comment noting areas that need review or verification.",
        page: 3,
        timestamp: "1h ago"
      }
    ],
    tabHighlights: {
      similarPapers: [
        {
          title: "Related research example",
          description: "Description of how similar papers connect to this research topic."
        }
      ],
      experts: [
        {
          title: "Expert Name",
          description: "Brief description of the expert's relevant experience and expertise."
        }
      ]
    }
  },
  {
    id: "paper-3",
    slug: "third-sample-paper",
    title: "Third Sample Research Paper",
    doi: "10.1109/sample.2025.123",
    owner: "Research Lab",
    uploadedAt: "5d ago",
    venue: "Journal",
    year: 2025,
    status: "Ready",
    authors: ["Author X", "Author Y", "Author Z"],
    abstract:
      "Placeholder abstract describing the research problem, methodology, and key contributions. Actual content will be extracted from uploaded documents.",
    tabSummaries: {
      similarPapers: "+3",
      patents: "+2",
      theses: "+1",
      experts: "+4"
    },
    comments: [
      {
        id: "c4",
        author: "Team Member",
        text: "Sample comment about a specific section or finding.",
        page: 7,
        timestamp: "2d ago"
      },
      {
        id: "c5",
        author: "Reviewer",
        text: "Example note from a reviewer or collaborator.",
        page: 12,
        timestamp: "3d ago"
      }
    ],
    tabHighlights: {
      patents: [
        {
          title: "Related patent example",
          description: "Description of how patent applications connect to this research."
        }
      ],
      theses: [
        {
          title: "Related thesis work",
          description: "Summary of how doctoral research explores similar topics."
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

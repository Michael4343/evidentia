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
];

export const samplePaper = {
  doi: "10.48550/arXiv.2403.01234",
  title: "Self-Supervised Vision Transformers",
  authors: ["Linnea Ortega", "Jamal Khatri", "Priya Nair"],
  venue: "arXiv",
  year: 2025,
  status: "Ready",
  abstract:
    "Vision transformers can learn robust representations via masked token prediction and contrastive distillation. This prototype surfaces the abstract for unauthenticated readers and gates the full PDF interactions behind sign-in.",
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
  ]
};

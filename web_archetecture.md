Interactive Paper Web App Architecture (Next.js + Supabase)

## Current Prototype Snapshot (2025-02-14)
- We ship a single-page marketing experience: the hero dropzone lives at the top and a single preview card shows the reader mock.
- No navigation tabs or sidebar components are active on the landing page; the preview intentionally keeps copy sparse and styling clean (white cards, subtle borders).
- Supporting reader components and richer mock data remain in the codebase for future phases but are not rendered today.

Use this document as the north star for the full product. Sections below capture the ambitious architecture we plan to grow into once we validate the minimalist SPA.

## Goals

Upload a PDF and create an interactive reading experience powered by GPT-5.

Always render figures faithfully, and later treat figures as first-class objects.

Show abstract to unauthenticated users. Gate “Show Full Paper” behind Google sign-in.

Real-time processing feedback.

Tabs: Paper, Similar Papers, Similar Patents, PhD Theses, Expert Network.

## Tech Stack

Next.js App Router, React, TypeScript, Tailwind.

Supabase: Auth, Postgres, Storage, Realtime, pgvector.

Worker for heavy PDF work and figure extraction.

OpenAI GPT-5 and GPT-5 Vision for analysis and figure captions.

## High-Level Flow

User drops a PDF on the landing page.

API uploads file to Supabase Storage, extracts DOI, upserts paper row, enqueues processing job.

Realtime status updates drive a progress UI.

When ready, Paper tab shows abstract for everyone and full paper for signed-in users.

User can select text to highlight, comment, or request verification.

Figures always render via the PDF viewer. When the figure pipeline is enabled, figures also appear as thumbnails with a lightbox and hotspots.

Routing and Layout

/(app)/layout.tsx header with five tabs and auth controls.

Routes

/ landing + upload

/paper/[doi] interactive reader

/paper/[doi]/similar-papers

/paper/[doi]/patents

/paper/[doi]/theses

/paper/[doi]/experts

Keep current paper DOI in route. Prefetch tab data after processing.

Landing Page and Upload

Keep the landing screen sparse: headline, one supporting sentence, and the dropzone.
Only introduce tiles or extra UI blocks when they materially aid comprehension.

Drag-and-drop with react-dropzone accepting application/pdf.

POST /api/upload

Parse PDF metadata and first pages to find DOI.

Store file in storage://papers/{sanitised-doi or checksum}.pdf with upsert.

Upsert papers by DOI and increment upload_count.

Insert processing_jobs row and return { doi, abstract?: string, status }.

Show an upload bar then stepwise status

Uploading

Extracting text

Analysing with AI

Generating interactive content

Complete

Authentication and Access

Supabase Auth with Google OAuth.

Abstract and minimal metadata are public.

“Show Full Paper” button triggers Google sign-in. After sign-in, fetch full content.

Use row-level security to ensure users only see their own annotations and verification requests. Papers are readable by all for dedupe.

Paper Tab: Reader and Interactions

Rendering

Use a PDF.js-based viewer like react-pdf-viewer.

Canvas renders pages and figures exactly.

Text layer overlay enables selection and highlights.

Interactions

Selection menu with Highlight, Comment, Request Verification.

Persist annotations to Supabase. Show sidebar list of user annotations.

Accessibility

Keyboard navigation in viewer.

When figures become objects, add alt text from GPT-5 Vision.

Figures: Always Show, Then Upgrade
MVP

Rely on the PDF viewer. All figures render inline on canvas with zoom and pan.

Optional “Figures” sidebar that scans page text for “Figure X” and jumps to pages.

Figures v1: Structured Figures

Worker pipeline

Trigger on upload or after text extraction.

Run pdffigures2 or a layout model to detect figure boxes and captions.

Crop and save thumb and full PNGs to storage://papers/{doi}/figures/fig_{n}.png.

Write figures rows with normalised page coordinates.

Frontend

Draw transparent hotspots on pages using normalised boxes so they align at any zoom.

Thumbnails panel showing label and caption. Click to jump or open lightbox.

Lightbox with full-res image, caption, alt text, and actions for annotate or verify.

Extend annotations with target_type = 'figure' and figure_id.

Optional AI

GPT-5 Vision generates alt_text and ai_caption.

Store embeddings of captions for future similar-figure search.

Access

Figures in a private bucket. Generate signed URLs for thumbs and full images.

Similar Tabs (outline only)
Similar Papers

On processing, compute an embedding for the paper abstract or sections.

Store in papers.embedding using pgvector.

Query nearest neighbours to surface related papers.

UI: list of titles, authors, year, short rationale. Links to DOI or load into app.

Similar Patents

Use paper keywords or embeddings to query a patent source or your own index.

UI: patent title, number, assignee, short excerpt, link out.

PhD Theses

Similar approach to papers using available repositories or your index.

UI mirrors Similar Papers.

Expert Network

Show status of verification requests. Later, an expert view to answer.

Verification on text or figures.

Database Schema (minimum)
create table papers (
  doi text primary key,
  title text,
  authors jsonb,
  abstract text,
  storage_path text not null,
  status text default 'processing',
  progress int default 0,
  upload_count int default 1,
  embedding vector(1536),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table annotations (
  id bigserial primary key,
  paper_doi text not null references papers(doi) on delete cascade,
  user_id uuid not null,
  target_type text not null default 'text' check (target_type in ('text','figure')),
  figure_id bigint references figures(id),
  page int,
  text_snippet text,
  coords jsonb,              -- page rects for text highlights
  comment text,
  type text not null default 'highlight' check (type in ('highlight','comment','verification')),
  created_at timestamptz default now()
);

create table verifications (
  id bigserial primary key,
  paper_doi text not null references papers(doi) on delete cascade,
  annotation_id bigint references annotations(id),
  requester_id uuid not null,
  expert_id uuid,
  status text not null default 'pending' check (status in ('pending','in_review','answered','closed')),
  answer text,
  created_at timestamptz default now(),
  answered_at timestamptz
);

create table figures (
  id bigserial primary key,
  paper_doi text not null references papers(doi) on delete cascade,
  page int not null,
  label text,
  caption_text text,
  bbox_norm jsonb not null,  -- { "x0":0.12,"y0":0.34,"x1":0.78,"y1":0.60 }
  image_path text not null,
  thumb_path text,
  width_px int,
  height_px int,
  alt_text text,
  ai_caption text,
  embedding vector(768),
  created_at timestamptz default now()
);

create table processing_jobs (
  id bigserial primary key,
  paper_doi text not null references papers(doi) on delete cascade,
  stage text default 'queued',
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);


Row-level security outline

papers: select for all, insert and update only via server role or edge function.

annotations: select and modify where user_id = auth.uid(). Experts can read for assigned verifications if needed.

verifications: requester can read own, experts can read assigned or all pending, enforce via policies.

Storage Layout

papers/{sanitised-doi or checksum}.pdf

papers/{doi}/figures/fig_{n}.png

papers/{doi}/figures/fig_{n}_thumb.png

Private buckets with signed URLs. Set sensible cache headers.

API Surface

POST /api/upload

Multipart PDF. Returns { doi, status, abstract? }.

GET /api/papers/[doi]

Public minimal metadata and abstract.

GET /api/papers/[doi]/full

Requires auth. Returns structured content or signed URL to PDF plus section map.

GET /api/papers/[doi]/figures

Returns figure metadata and signed thumb URLs.

POST /api/annotations

Requires auth. Create highlight or comment. Supports target_type text or figure.

POST /api/verify

Requires auth. Opens a verification request linked to an annotation.

Processing Pipeline
Text and Structure

Extract text, title, authors, abstract. Persist to papers.

Generate section map if feasible. Compute embeddings.

GPT-5 creates summaries per section for later use.

Figures

Worker downloads PDF from Storage.

Run pdffigures2 or layout model to detect figure boxes and captions.

Crop and upload thumbs and full images.

Insert figures rows with normalised coordinates.

Optional GPT-5 Vision captions and alt text.

Update papers.progress and status.

Real-time Status

Client subscribes to papers row by DOI.

Update on stage changes and numeric progress.

Reader Implementation Details

Use react-pdf-viewer with text layer plugin to enable selection.

Selection popover actions

Highlight: store coords, page, text_snippet.

Comment: same as highlight with comment.

Verify: create annotations with type = 'verification' then verifications row.

Figures v1

Render hotspots from figures.bbox_norm.

Thumbnails panel and lightbox with signed URLs.

Annotations on figures set target_type = 'figure' and figure_id.

Environment and Config

NEXT_PUBLIC_SUPABASE_URL

NEXT_PUBLIC_SUPABASE_ANON_KEY

SUPABASE_SERVICE_ROLE_KEY for server routes or worker

OPENAI_API_KEY

Google OAuth client ID and secret configured in Supabase

Folder Structure (suggested)
/app
  /(marketing)/page.tsx               # landing + upload
  /paper/[doi]/page.tsx               # reader
  /paper/[doi]/similar-papers/page.tsx
  /paper/[doi]/patents/page.tsx
  /paper/[doi]/theses/page.tsx
  /paper/[doi]/experts/page.tsx
  /layout.tsx
  /api/upload/route.ts
  /api/papers/[doi]/route.ts
  /api/papers/[doi]/full/route.ts
  /api/papers/[doi]/figures/route.ts
  /api/annotations/route.ts
  /api/verify/route.ts
/lib
  supabase.ts
  auth.ts
  progress.ts
  doi.ts
  pdf.ts
/components
  UploadDropzone.tsx
  Reader.tsx
  FigureHotspots.tsx
  FiguresPanel.tsx
  Lightbox.tsx
  SelectionMenu.tsx
  ProgressBar.tsx

Roadmap

Phase 0

Upload, DOI dedupe, abstract display, Google-gated full paper, progress UI.

PDF viewer with text selection, highlights, comments, verification requests.

Phase 1

Worker and figure extraction, hotspots, thumbnails, lightbox, signed URLs.

GPT-5 Vision for alt text and captions.

Phase 2

Similar tabs wired to embeddings and external sources.

Expert console and notifications.

Chat with paper using retrieval on sections and captions.

Notes

Use DOI as the single source of truth to avoid duplicates and to aggregate uploads and annotations.

Keep figures private in Storage and always render via the viewer for reliability. Promote them to first-class objects when the worker is available.

Prefer Supabase Realtime for progress over polling.

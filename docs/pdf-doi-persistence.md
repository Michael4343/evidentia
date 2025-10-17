# PDF DOI persistence

## Overview
Uploads on the landing page now extract a DOI from the PDF (first DOI-like token within the first five pages) and persist the paper to Supabase for the signed-in user. Saved papers rehydrate the sidebar and reader whenever the user returns.

## Flow
1. `extractDoiFromPdf(file)` uses `pdfjs-dist` to read the first pages and locate a DOI pattern. The helper also falls back to PDF metadata.
2. `persistUserPaper` uploads the file to the `papers` storage bucket and stores a row in `user_papers` with the DOI and metadata.
3. When the session changes, `fetchUserPapers` loads the saved rows, resolves public or signed URLs, and seeds the sidebar/library state.
4. The reader keeps showing the currently active paper and surfaces the linked DOI below the viewer.

## Supabase requirements
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Storage bucket: `papers` (public or private with signed URLs allowed).
- Table: `user_papers` with at least
  - `id uuid` (PK/default `uuid_generate_v4()`),
  - `user_id uuid` (FK to `auth.users`),
  - `doi text`,
  - `title text`,
  - `file_name text`,
  - `file_size bigint`,
  - `storage_path text`,
  - `uploaded_at timestamptz default now()`.

## Follow-ups
- Add UI feedback for storage or insert failures per field.
- Offer manual DOI override when extraction fails.
- Consider generating short-lived signed URLs on demand if the bucket is private.

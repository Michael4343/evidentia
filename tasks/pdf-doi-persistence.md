# PDF DOI persistence plan

## Scope
- Extract a DOI from each uploaded PDF and persist the upload metadata for the signed-in user.
- Store the PDF in Supabase Storage so it can be reopened later from the library list.
- Load the saved papers when the user signs in and hydrate the sidebar/reader state.

## Assumptions
- A Supabase project is available with anon/service keys configured in the environment.
- A storage bucket named `papers` (public or signed URL capable) exists or can be created ahead of time.
- A `user_papers` table is available with columns compatible with the metadata we will insert (`id`, `user_id`, `doi`, `title`, `file_name`, `file_size`, `storage_path`, `uploaded_at`).
- Upload sizes remain small enough that client-side PDF parsing is feasible for now.

## Steps
1. Add PDF DOI extraction helpers that can read text from a PDF blob and capture the first DOI-like token.
2. Wire Supabase browser utilities so the landing page can upload PDFs to storage, write metadata rows, and fetch saved papers for the active user.
3. Update the landing page upload flow to call the DOI helper, persist the data, and restore persisted papers on session changes (with basic error handling/toasts).
4. Document new behaviour, follow-ups, and any environment/setup expectations.

## Status
- [x] Plan written
- [x] DOI helper implemented
- [x] Supabase persistence utilities in place
- [x] Landing page wired to persistence
- [x] Documentation updated

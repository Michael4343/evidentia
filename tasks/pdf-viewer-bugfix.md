# PDF viewer bugfix plan

## Context
- Uploads succeed but the PDF preview falls back to the inline warning.
- Remote files are stored in Supabase and may no longer be publicly readable.
- The viewer currently relies on `<object data={activePaper.url}>`, so any fetch failure or forced download breaks the embed.

## Plan
1. Trace how `activePaper.url` is produced for local vs. Supabase-backed uploads, and confirm the URLs we hand to the viewer.
2. Adjust the storage helpers to return a viewer-friendly, accessible URL (prefer signed links or fetch-and-cache locally) when the bucket is private or headers force download.
3. Update the reader tab to consume the safer URL, add graceful error handling, and keep previously generated object URLs cleaned up.
4. Exercise an upload locally to verify the inline preview renders again, document the fix, and update `CLAUDE.md` with the latest tree.

## Assumptions
- Supabase credentials are configured and a storage bucket named `papers` exists.
- We can rely on the existing Supabase client utilities without altering auth flows.

## Step 8 (2025-02-18)
- Requirement: hide the default toolbar chrome in the inline viewer so the PDF surface feels integrated.
- Approach: append `toolbar=0&navpanes=0&scrollbar=0` to the blob URL we hand to the `<object>` tag, keeping the original link for downloads.

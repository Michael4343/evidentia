# Sidebar Library Plan

## Scope
Implement an initial paper library in the sidebar that stores uploaded papers from the landing page. Focus only on the "Paper" tab workflow: accept a PDF upload, display it in the main area, and persist it in a simple in-memory list shown in the sidebar.

## Assumptions
- Browser-side only; no backend persistence yet.
- PDF rendering can rely on the browser's native support via `object`/`iframe`.
- Authentication gating is relaxed for now; anyone can upload while we prototype.

## Steps
1. Implement the upload workflow: capture PDFs, store them in landing-page state, and expose the callbacks needed by the dropzone.
2. Build the sidebar library list so uploaded papers appear and can be selected.
3. Render the active paper preview and wrap up documentation updates.

## Progress
- [x] Upload workflow wired between the dropzone and landing-page state.
- [x] Sidebar now renders the uploaded library and highlights the active paper.
- [x] Active paper preview loads in the main tab and documentation refreshed.

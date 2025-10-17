## Objective
Hide the landing dropzone once a PDF is uploaded and surface a sidebar "Add paper" control so users can attach additional PDFs without extra UI.

## Plan
- [x] Update `AppSidebar` to accept an `onUpload` callback, render a hidden file input, and expose an "Add paper" button (`+` when collapsed) that opens the selector and forwards valid files.
- [x] Remove the secondary `UploadDropzone` from the paper view so the embedded PDF uses the full content area after upload.
- [x] Pass the upload handler from the landing page to the sidebar and sanity-check collapsed/expanded states plus multiple uploads.

## Assumptions
- Browser `File` selection is sufficient; no drag-and-drop needed in the sidebar button.
- Limiting the file input to PDFs keeps behaviour consistent with the existing dropzone.

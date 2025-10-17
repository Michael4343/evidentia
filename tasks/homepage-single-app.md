# Homepage Single Page Plan

## Goal
Refine the prototype into a self-contained single-page experience on the homepage, handling paper selection and tab switching without relying on Next.js routing.

## Steps
1. ✅ Extend the mock data to expose detailed paper information retrievable by slug.
2. ✅ Update reader components (sidebar, tab nav, hero, shell, content) to consume the data, work with callbacks, and avoid Next.js links for client-side state.
3. ✅ Implement a client-side homepage controller that manages selected paper/tab state and renders the shared shell, removing redundant paper routes.
4. ✅ Refresh project docs to capture the streamlined prototype structure and new components.

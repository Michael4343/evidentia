# Task: V0 UI Mock & Prototype Plan

## MVP Scope (v0)
- Landing page with drag-and-drop PDF upload affordance and progress stages.
- Auth-gated paper reader: abstract visible to all, full paper behind Google sign-in call-to-action.
- Basic paper reader view with PDF canvas stub, annotation sidebar placeholder, and status banner.
- Realtime status placeholders to show staged processing feedback (static in mock).
- No worker/figure pipeline yet; figures render via base PDF view only.

## Assumptions
- We will initialise a fresh Next.js 14 + Tailwind project in this repo for the UI mock.
- Supabase integration, storage, and worker pieces are deferred until after UI approval.
- PDF rendering for the mock can rely on placeholder imagery or a lightweight viewer scaffold without file upload wiring.
- Google OAuth button can be a styled placeholder until auth wiring is implemented.

## Approach Overview
1. Design UI mock screens directly in code using static data and tailwind components.
2. Iterate on layout to confirm navigation, upload flow, progress feedback, and paper reader structure.
3. After UI approval, progressively connect backend endpoints (upload API, Supabase, annotations) following the Phase 0 roadmap.

## Work Phases
1. **Phase A – UI Mock Implementation**
   - Set up Next.js project structure mirroring the proposed architecture.
   - Build landing page with drag-and-drop area and minimal supporting copy.
   - Create paper reader page with tab header, PDF viewer frame, abstract/full content split, and annotation sidebar placeholders.
   - Add basic responsive styling and Tailwind config; ensure mock data drives all states (e.g., processing vs complete).
2. **Phase B – Backend Wiring (post-approval)**
   - Implement Supabase client setup, upload API route, and file storage integration.
   - Add auth gating, realtime progress updates, and annotation persistence.
   - Validate end-to-end flow with sample PDF.

## Open Questions & Decisions
- Mock styling: target a production-ready Tailwind look (clean, polished, no wireframe aesthetic).
- Similar tabs: keep focus on the Paper tab for the mock; leave other tabs as placeholders.
- Branding: no specific brand palette yet—choose a pleasant, neutral color scheme.

## Implementation Notes (2025-10-17)
- Initialised custom Next.js 14 + Tailwind setup with shared layout and polished header/footer.
- Built landing page mock around a single drag-and-drop upload surface with minimal supporting copy.
- Created paper reader mock with tab navigation, PDF viewer placeholder, streamlined annotation sidebar, and auth gating callouts.
- Header nav mirrors paper tabs with placeholder links for adjacent views.
- Added placeholder pages for Similar Papers, Patents, Theses, and Expert Network tabs to outline future content.
- Refined the mock to a cleaner layout: upload dropzone stands alone, reader scaffold stays focused on core v0 interactions.
- Updated contributor docs to call out that linting only runs when explicitly requested.

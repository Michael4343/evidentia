# Sidebar Shell Implementation Plan (v0.1)

## Goal
Design a compact, collapsible left sidebar that absorbs the current header content ("Evidentia" brand and primary sign-in call-to-action) while keeping the five reader tabs as the primary navigation for the second-column content area.

## User Requirements
- Sidebar hosts the Evidentia brand mark at the very top and a prominent "Sign In" entry directly beneath it.
- A small toggle affordance lets users collapse the sidebar to an icon-only rail; the main content remains visible on the right.
- The five reader tabs (Paper, Similar Papers, Patents, PhD Theses, Expert Network) continue to control the main page content.
- Layout stays minimal and elegant—white background, light borders, subtle depth.
- No new routes or server processes; changes live within the existing single-page experience.

## Proposed Layout Structure
1. **Shell Container**
   - Two-column flex layout: sidebar (fixed width, collapsible) + main content (flex-1).
   - Maintain sticky behaviour for the sidebar so navigation stays anchored on scroll.
2. **Sidebar Content Stack**
   - Brand row with mark + "Evidentia" text; collapse state shows only the mark.
   - "Sign In" button directly below the brand row.
   - Navigation list for the five tabs with active styling carried over.
   - Optional footer space reserved for future actions (e.g., upload, settings).
3. **Toggle Control**
   - Floating button aligned to the sidebar edge (visible on desktop) that toggles between expanded (show text labels) and collapsed (icons/initials only).
   - On mobile, reuse the existing top bar pattern but respect the collapsed state when the sidebar is visible.

## Implementation Steps
1. **Refactor Layout Wiring**
   - Update `app/page.tsx` to source layout state (active tab, sidebar collapsed) and pass the new props to `AppSidebar`.
   - Remove the redundant mobile header brand/sign in block if the sidebar covers that role.
2. **Enhance `AppSidebar` Component**
   - Introduce a `collapsed` prop and internal class toggles for width, text visibility, and spacing.
   - Restructure the markup: brand row → sign-in button → nav stacked list; ensure accessible labels remain when collapsed (e.g., `aria-label`).
   - Add the toggle button inside the sidebar (top-right) with an icon that flips depending on state.
3. **Style Polish & Motion**
   - Tailwind classes for smooth width/opacity transitions, subtle border shadow, consistent padding.
   - Ensure focus states are legible in both expanded and collapsed modes.
4. **Responsive Behaviour**
   - Preserve an overlay mobile menu for sub-`lg` breakpoints (either via sheet or existing approach) so users can still access navigation.
   - Verify the content column uses the full width when the sidebar is collapsed on desktop.

## Testing Plan
- Manual pass in desktop widths: expand/collapse toggles, active tab styling, focus management via keyboard.
- Manual pass in narrow viewport to confirm mobile fallback still works.
- Basic accessibility spot-check: ensure buttons have labels and tab order makes sense.

## Documentation & Follow-up
- Update `CLAUDE.md` directory snapshot after implementation.
- Capture final interaction summary in `docs/` if additional rationale is needed.
- Surface any follow-up tasks (icon set, auth wiring) once UX is validated.

## Open Questions
- Should the collapsed state persist across sessions (local storage) or reset on reload? (Default: reset.)
- Any additional sidebar entries (e.g., settings/help) planned for near-term iterations?
- Confirm whether the mobile view should expose the collapsed control or remain full-width drawer only.

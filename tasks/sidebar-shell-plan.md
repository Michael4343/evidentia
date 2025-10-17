# Sidebar Shell Implementation Plan (v0.3)

## Goal
Deliver a calm, minimal left sidebar that carries the brand + auth entry while a collapsible toggle keeps the column unobtrusive, and the five reader buttons live in the main page header for clarity.

## User Requirements
- Sidebar shows the Evidentia wordmark at the top with a gentle supporting tagline.
- A single primary `Sign In` button sits immediately beneath the brand block.
- A slim toggle affordance keeps the sidebar collapsible; when collapsed, only the icon mark and toggle remain visible.
- The five reader buttons (Paper, Similar Papers, Patents, PhD Theses, Expert Network) render in the main content column, likely as a horizontal strip beneath the top padding.
- Layout keeps a simple, elegant feel with white backgrounds, light borders, and minimal chrome.

## Proposed Layout Structure
1. **Shell Container**
   - Two-column flex: sidebar at ~240px when expanded, ~72px when collapsed; content column flex-1.
   - Soft divider using a 1px slate border; subtle shadow only on hover/open if needed.
2. **Sidebar Content Stack**
   - Brand block: small circular "Ev" badge, `Evidentia` wordmark, optional `Interactive papers` caption in muted text.
   - `Sign In` button styled as a light ghost or outline pill to keep the feel airy.
   - Toggle button pinned near the outer edge (top-right or mid-height) to collapse/expand the column.
   - Sidebar intentionally omits the reader buttons once they move to the main page; reserve lower space for future secondary actions if needed.
3. **Main Content Alignment**
   - Introduce a main-column header strip that houses the five reader buttons; align it with existing spacing so the page still feels single-surface.
   - Remove the redundant desktop header; keep current mobile top bar until a dedicated mobile treatment is designed.

## Implementation Steps
1. **State & Layout Wiring**
   - Manage `collapsed` state in `app/page.tsx` (expanded by default) and pass it to the sidebar component.
   - Ensure content column reacts to the collapsed width so spacing stays balanced.
2. **Sidebar Component Update**
   - Update `AppSidebar` to show brand + sign-in stack and new toggle button; hide text labels when collapsed while keeping accessible labels.
   - Add smooth transition classes for width, opacity, and positioning.
3. **Main Content Header**
   - Move the reader buttons (`Paper`…`Expert Network`) into a horizontal `PaperTabNav` strip within the main column, above the tab content.
   - Align typography and spacing with the simplified sidebar.
4. **Styling Polish**
   - Refine padding, border, and hover states across sidebar and main header to maintain the elegant, minimal tone.

## Testing Plan
- Manual desktop pass: confirm sidebar toggle behaviour, tab switching, active highlight, and that the header content is no longer duplicated.
- Manual narrow-width pass: ensure the existing mobile top bar still exposes navigation appropriately.
- Quick keyboard traversal to confirm tab order and focus rings remain visible.

## Documentation & Follow-up
- Update `CLAUDE.md` snapshot after implementation.
- Note the simplified direction in project docs if the design language shifts further.
- Revisit potential enhancements (icons, collapse, secondary actions) only if future feedback asks for them.

## Open Questions
- Should the collapsed sidebar auto-expand on hover or stay click-toggle only?
- Do we want future secondary actions (e.g., upload, settings) in the sidebar once real auth is present?
- Should the main-page tab strip stay horizontal or adapt to a stacked layout on smaller yet still `lg` breakpoints?

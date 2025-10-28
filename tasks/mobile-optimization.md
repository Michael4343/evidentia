# Mobile Optimization Plan

## Minimum viable outcome
- Ensure the main reader screen is readable on a sub-768px viewport: sidebar does not squish content, PDF area and tab panels stack cleanly, and essential actions stay tappable.

## What we skip for v0.1
- No dedicated swipe gestures or bottom navigation.
- No refactor of every panel for pixel-perfect spacing; only fix obvious overflow/spacing issues.
- Do not rebuild the upload experience; reuse the existing components with responsive tweaks.

## Definition of done
- On a narrow viewport the layout stacks vertically with no horizontal scrolling.
- Sidebar content is accessible without overlapping the reader, even if it simply renders above the content.
- The mobile warning modal fits within the viewport and remains dismissible.
- Desktop layouts remain unchanged.

## Implementation steps
1. Audit the current layout to spot hard-coded widths/heights that break on mobile and note where adjustments are needed (sidebar, main container, header).
2. Adjust the root layout and sidebar so the app stacks on small screens (e.g. flex-col by default, sidebar full width, hide collapse toggle on mobile) while keeping desktop behaviour intact.
3. Tighten spacing and sizing for the header/tab nav, content padding, PDF viewer height, and the mobile warning modal so they are legible on mobile.
4. Manually verify styles in responsive devtools (cannot run automated tests) and sanity-check that desktop view still matches the current look.

# Tutorial Modal Plan

## Minimum viable outcome
- Show a dismissible desktop-only modal that embeds the tutorial video when a `NEXT_PUBLIC_TUTORIAL_URL` env var is provided (fall back to a link if embedding fails).

## What we skip for v0.1
- No persistent analytics or PostHog events.
- No fancy animations or multi-step onboarding flows.
- No server-side storage of dismissal state; just client memory/localStorage.

## Definition of done
- Desktop viewport displays the tutorial modal once per session when the env var exists and allows dismissal.
- Mobile warning modal offers an inline "Watch tutorial" action when the same env var exists.
- Modal styling plays nicely with existing overlays and is fully dismissible.

## Implementation steps
1. Build a lightweight `TutorialModal` client component that checks viewport size, reads the env var, and uses storage to avoid repeat popups per session.
2. Mount the tutorial modal from the root layout alongside the mobile modal.
3. Update the existing mobile modal to surface the embedded tutorial cleanly when present and remember dismissals.
4. Manual sanity check across viewport widths to confirm modal visibility logic and video playback.

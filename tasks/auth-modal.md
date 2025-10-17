# Auth modal MVP plan

## Scope
- Add a reusable `AuthModal` component with validation and loading states that matches the provided spec.
- Provide a simple client-side auth handler that can be replaced with real API calls later.
- Wire the modal to open from existing sign-in buttons and the upload dropzone interaction.

## Assumptions
- No real authentication backend is available yet; success paths can resolve locally after a short delay.
- Google auth triggers can be treated as placeholders that simply resolve for now.
- Existing upload flow does not need to persist file selection until auth is implemented.

## Steps
1. Build the `AuthModal` UI component with controlled mode switching, validation, error banner, and keyboard/overlay dismissal.
2. Create an `AuthModalProvider` with a `useAuthModal` hook to manage modal visibility, simulated auth handlers, and expose `open`/`close` helpers.
3. Integrate the provider in the root layout and update `AppSidebar`, `ReaderSidebar`, `UploadDropzone`, and any sign-in CTA to open the modal with the correct mode.
4. Manually test triggers (sidebar button, dropzone, google/email actions) and document the update in `CLAUDE.md` with the refreshed directory snapshot.

## Status
- [x] Build modal component.
- [x] Provide modal context and handlers.
- [x] Wire triggers across UI.
- [x] Manual pass and documentation updates.

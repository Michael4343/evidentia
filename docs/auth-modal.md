# Auth modal overview

## Purpose
- Provide a consistent UI entry point for Supabase-backed authentication (email/password + Google OAuth).
- Centralise session state so layout elements can react to logged-in users (e.g., swap sign-in CTAs for account details).

## Components
- `components/auth-modal.tsx` renders the dialog, performs field validation, displays success/error notices, and triggers Supabase handlers passed from context.
- `components/auth-modal-provider.tsx` bootstraps the browser Supabase client, tracks the active session, exposes `useAuthModal()`, and surfaces helpers such as `open`, `setMode`, and `signOut`.

## Session & context
`useAuthModal()` now returns:
- `open(mode?)` / `close()` / `setMode(mode)` — control modal visibility.
- `user` / `session` — Supabase user + session (null when signed out).
- `isAuthReady` — `true` once the initial session check completes (useful for disabling buttons until hydration finishes).
- `signOut()` — calls `supabase.auth.signOut()` and updates context.
- `mode`, `isOpen` — internal modal state for callers that need to reflect UI changes.

## Authentication flows
- **Login** — Uses `supabase.auth.signInWithPassword`; closes the modal on success.
- **Sign up** — Uses `supabase.auth.signUp`; if email confirmation is required the modal stays open and shows an inline “check your email” notice.
- **Google OAuth** — Uses `supabase.auth.signInWithOAuth`; on success the browser follows Supabase’s redirect URL (defaults to the current origin).

## Supabase configuration
- Requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`.
- Optional email redirect target inherits `window.location.origin`; adjust inside `AuthModalProvider` if a dedicated callback route is added.
- Missing environment variables log a console error and leave the modal in a disabled/fallback state.

## Triggers
- Sidebar auth button (`components/app-sidebar.tsx`).
- Reader shell CTA (`components/reader-sidebar.tsx`).
- Header sign-in/out controls (`components/site-header.tsx`).
- Upload dropzone gate (`components/upload-dropzone.tsx`).

## Behaviour highlights
- Buttons block until `isAuthReady` to avoid hydration mismatches.
- Modal notices now support both error and success/info messaging.
- Context exposes `signOut()` so headers/sidebars can swap CTA text and show user initials/email.
- Google OAuth redirects immediately; the modal closes only if the promise resolves without navigation (e.g., pop-up blockers).

## Follow-ups
- Add dedicated post-auth landing or deep links (e.g., `/auth/callback`).
- Persist uploaded files once Supabase storage or backend ingestion is in place.
- Extend context with profile metadata when available from the database.

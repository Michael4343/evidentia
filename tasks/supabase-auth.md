# Supabase auth integration plan

## Scope
- Replace the placeholder authentication handlers with real Supabase email/password and Google OAuth flows.
- Track the active session in context so UI elements can react to logged-in users and expose sign-out.
- Keep the modal-centric UX while surfacing meaningful error messages from Supabase.

## Assumptions
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set in `.env.local`.
- Email-based sign-up may require verification depending on Supabase project settings; handle this gracefully in messaging.
- No server-side routes are yet consuming the session, so client-only handling is acceptable for this iteration.

## Steps
1. Introduce a Supabase browser client helper and update `AuthModalProvider` to own session state, sign-in/up, OAuth, and sign-out flows.
2. Extend the auth context value to expose `user`, `loading`, and `signOut`, and make sure modal-triggering components still function.
3. Refresh header/sidebar/dropzone UI to reflect logged-in state (e.g., show user email/initials, provide sign-out) while deferring gated actions to future tickets.
4. Manually exercise login, signup (including confirmation-required paths), Google auth initiation, and sign-out; document behaviour and outstanding follow-ups.

## Status
- [x] Plan written
- [x] Provider updated with Supabase wiring
- [x] UI reflects session state
- [x] Manual pass + docs

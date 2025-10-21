# Login Upload Redirect

- **Absolute minimum to prove this works?** Add a user-session effect on the homepage that flips the view back to the upload dropzone whenever the auth state changes.
- **What can we skip for v0.1?** Any routing refactors, Supabase server updates, or broader sidebar clean-up—limit the change to the client-side state reset.
- **How will we know it's done?** Manually verify that logging in and logging out both reveal the upload dropzone in the main panel without throwing UI or console errors.

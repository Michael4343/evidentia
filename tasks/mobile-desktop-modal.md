# Mobile desktop handoff modal plan

## What's the absolute minimum to prove this works?
- Detect mobile viewport on the client and render a blocking modal with the required copy.
- Ensure the modal prevents interaction with the main app until dismissed (or redirect).

## What can we skip for v0.1?
- No server-side user agent detection.
- No persistent dismissal state across sessions.
- No animation polish or responsive tuning beyond basic readability.

## How will we know it's done?
- Loading the app on a small viewport reliably shows the modal with the supplied message.
- Desktop viewport renders without the modal.
- Modal structure passes a quick manual check in the browser console without runtime errors.

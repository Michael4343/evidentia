# Loading Subtext Removal

- **Absolute minimum to prove this works:** Remove the descriptive subtext lines from each loading state while keeping the primary loading headline intact.
- **Skip for v0.1:** No redesign, copy rewrites, or new loading behaviors beyond stripping the subtext. Do not add new components or logic.
- **How we'll know it's done:** Every loading surface shows only its main label (e.g., `Compiling similar papers…`) with no supporting tagline; manual check confirms there are no lingering subtext strings in the UI.

## Plan
1. Inventory all loading components/messages that currently display subtext copy.
2. Edit each component to remove the subtext element while leaving the primary loading indicator untouched.
3. Manually verify by searching the codebase for the removed strings to confirm they no longer exist.

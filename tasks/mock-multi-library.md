# Mock Library Multi-Entry Plan

## Minimum viable outcome
- Allow homepage to display multiple mock papers without losing existing rich tab data.
- Update generation scripts to append new mock datasets instead of overwriting.
- Ensure selecting any mock paper loads its saved claims/similar/patent/etc. content.

## Skip for v0.1
- Automated tests; manual smoke test is fine.
- Admin UI for managing mock entries.
- Refactoring scripts beyond what’s needed for multi-entry support.

## Definition of done
- Homepage shows each mock entry in sidebar and renders correct data per tab when selected.
- Running mock data scripts adds/updates entries without clobbering others.
- Simple CLI util exists to delete an entry (manual confirmation OK).
- Manual verification notes recorded.

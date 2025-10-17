# CLAUDE.md - Project Development Guide

**Primary Directive: Ship working code. Start simple. Validate before adding complexity.**

## 🎯 Core Philosophy

### The Prototype-First Approach
1. **Build the simplest thing that works** - No abstractions, no over-engineering
2. **Get it in front of users immediately** - Real feedback beats perfect architecture
3. **Add complexity only when pain is real** - Measure, don't assume
4. **Working prototype > Perfect design** - Always

### Reality Check
- If you're building abstractions before you have working features, STOP
- If you're optimizing before you have users complaining, STOP
- If you're adding "nice to have" patterns before core functionality works, STOP
- Ship first. Refine second. Perfect never.

## Planning & Execution

### Before Starting Any Task
1. Create a plan in `tasks/TASK_NAME.md` with:
   - What's the absolute minimum to prove this works?
   - What can we skip for v0.1?
   - How will we know it's done?
2. Default to the simplest approach
3. Question every "should we also..." instinct

### Task Strategy
- **Start**: Get ONE thing working end-to-end
- **Then**: Handle the obvious failure case
- **Finally**: Polish only what users will touch
- **Never**: Add features "for later" or "just in case"

## Code Standards

### Progressive Development
```
v0.1 → Barely works, proves the concept
v0.2 → Works for the main use case
v0.3 → Handles errors gracefully
v1.0 → Production-ready with tests
```

**Most features should ship at v0.2.** Resist v1.0 perfectionism.

### When to Add Complexity
Only add abstractions when:
- ✅ Code is repeated 3+ times AND causing bugs
- ✅ Prop drilling exceeds 3 levels AND slowing development
- ✅ Performance issues are MEASURED and user-impacting
- ✅ Multiple developers are blocked without the abstraction

## Project Context

### Tech Stack
- **Framework**: Next.js 14+ with TypeScript
- **Database**: Supabase (Postgres + Auth + Storage)
- **Styling**: Tailwind CSS, shadcn/ui components
- **State**: useState/Context (upgrade to Zustand only if needed)
- **Icons**: Lucide React

### Directory Structure
```
app/                    # Next.js app router pages
components/             # React components
lib/                    # Utilities and helpers
  ├── supabase-browser.ts   # Supabase client
  ├── user-papers.ts        # Paper persistence helpers
  └── pdf-doi.ts            # DOI extraction
docs/                   # Architecture decisions
tasks/                  # Implementation plans
```

### Key Environment Variables
```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
PERPLEXITY_API_KEY=...  # For research digest feature
```

### Common Commands
```bash
npm run dev      # Development server (usually already running)
npm run build    # Production build
npm run lint     # Only run when user asks
```

**IMPORTANT**: DO NOT start new dev servers - one is already running!

## UI Design Principles

### Minimalist First
- Let the primary action dominate the page
- Avoid tiles/cards unless they clarify hierarchy
- White backgrounds, light slate borders
- Tight copy, no verbose supporting text

### Current App State
- **Homepage**: Hero upload dropzone
- **Reader**: Collapsible sidebar (paper library) + full-width PDF viewer + tab navigation
- **Auth**: Modal-based (email/password + Google OAuth)

## Development Workflow

### The Right Way
1. Write minimal code to make it work
2. Test manually
3. Get user feedback
4. Iterate based on real needs

### The Wrong Way
1. ❌ Design comprehensive architecture
2. ❌ Build reusable abstractions
3. ❌ Add error handling for edge cases
4. ❌ Write tests before features work
5. ❌ Optimize performance proactively

## Testing & Shipping

### MVP Checklist
- [ ] Core feature works for happy path
- [ ] No breaking errors in console
- [ ] Basic user flow is complete
- [ ] SHIP IT

### Production Checklist (only if needed)
- [ ] Error handling for common failures
- [ ] Security: env vars, input validation, HTTPS
- [ ] Documentation: README, setup instructions
- [ ] Tests for critical paths

## Best Practices

### Start With
- Inline code > extracted functions
- Props > context
- useState > Zustand
- Manual testing > automated tests
- Comments in code > separate docs

### Evolve To (when patterns repeat)
- Shared components
- Proper state management
- Error boundaries
- Comprehensive tests
- Performance optimization

### Never Do
- Abstract before you have 3 examples
- Optimize before you measure
- Test before it works
- Document before it's stable
- Plan for scale before you have users

## Supabase Integration

### Database Schema
- **Table**: `user_papers` (id, user_id, doi, title, filename, created_at)
- **Storage**: `papers` bucket with RLS policies
- **Auth**: Email/password + OAuth providers

See `docs/supabase.md` for RLS policies and setup details.

### Key Patterns
```typescript
// Client-side Supabase
import { createClient } from './lib/supabase-browser'

// Upload PDF
const { data } = await supabase.storage
  .from('papers')
  .upload(`${userId}/${filename}`, file)

// Insert metadata
await supabase.from('user_papers')
  .insert({ user_id, doi, filename, title })
```

## Documentation

### What to Document
- **Always**: Implementation plans in `tasks/` before coding
- **When stable**: Architecture decisions in `docs/`
- **Never**: Inline docs for unstable features

### DO NOT
- Create documentation files proactively
- Write extensive README sections before features stabilize
- Add code comments explaining "why we might need this later"

## Remember

**The best code ships fast and works.**

- Prototype beats architecture
- User feedback beats assumptions
- Simple beats clever
- Done beats perfect

## Directory Snapshot (2025-10-18)
- `app/`
  - `(marketing)/page.tsx`
  - `globals.css`
  - `layout.tsx`
  - `page.tsx`
  - `paper/[doi]/layout.tsx`
  - `paper/[doi]/page.tsx`
  - `paper/[doi]/experts/page.tsx`
  - `paper/[doi]/patents/page.tsx`
  - `paper/[doi]/similar-papers/page.tsx`
  - `paper/[doi]/theses/page.tsx`
- `components/`
  - `annotation-sidebar.tsx`
  - `app-sidebar.tsx`
  - `auth-modal-provider.tsx`
  - `auth-modal.tsx`
  - `homepage-app.tsx`
  - `paper-hero.tsx`
  - `paper-reader-content.tsx`
  - `paper-reader-header.tsx`
  - `paper-reader-shell.tsx`
  - `paper-tab-nav.tsx`
  - `pdf-viewer-mock.tsx`
  - `pdf-viewer.tsx`
  - `reader-sidebar.tsx`
  - `site-header.tsx`
  - `status-banner.tsx`
  - `tab-highlights.tsx`
  - `upload-dropzone.tsx`
- `docs/`
  - `homepage-prototype.md`
- `lib/`
  - `mock-data.ts`
  - `pdf-doi.ts`
  - `supabase-browser.ts`
  - `user-papers.ts`
- `tasks/`
  - `auth-modal.md`
  - `clean-webpage-format.md`
  - `halo-tabs.md`
  - `header-cleanup.md`
  - `homepage-single-app.md`
  - `pdf-doi-extraction-fix.md`
  - `pdf-doi-persistence.md`
  - `pdf-title-link.md`
  - `pdf-upload-sidebar-button.md`
  - `pdf-viewer-bugfix.md`
  - `pdf-viewer-full-width.md`
  - `reader-header.md`
  - `sidebar-debug.md`
  - `sidebar-library.md`
  - `sidebar-shell-plan.md`
  - `sidebar-sidebar.md`
  - `single-page-app.md`
  - `single-page-prototype.md`
  - `single-page-sidebar-refactor.md`
  - `supabase-auth.md`
  - `v0_ui_mock.md`

**If you're not slightly embarrassed by your v0.1, you waited too long to ship.**

# CLAUDE.md - Project Development Guide

This file provides guidance for Claude when working with code in this repository.

## 🎯 Core Philosophy: Simple, Working, Maintainable

### Development Principles
1. **Start Simple** - Build the simplest working solution first
2. **Validate Early** - Get user feedback before over-engineering
3. **Iterate Thoughtfully** - Add complexity only when needed
4. **Document Clearly** - Make handoffs and maintenance easier

## Planning & Execution

### Before Starting
- Write a brief implementation plan to `tasks/TASK_NAME.md`
- Define the MVP scope clearly
- Document assumptions and approach
- Update the plan as you work

### Task Strategy
- Focus on getting core functionality working first
- Make incremental improvements
- Test changes before marking complete
- Document decisions for future reference

## Code Standards

### Quality Guidelines
- **Clarity** - Write readable, self-documenting code
- **Consistency** - Match existing patterns in the codebase
- **Simplicity** - Avoid premature optimization
- **Completeness** - Ensure changes work end-to-end

### Progressive Development
```
v0.1 → Basic working prototype
v0.2 → Handle main use cases
v0.3 → Add error handling
v1.0 → Production-ready
```

### When to Add Complexity
✅ Code is repeated 3+ times → Extract to function/component  
✅ Prop drilling exceeds 3 levels → Consider state management  
✅ Performance issues are measured → Optimize  
✅ Multiple developers need clear interfaces → Add abstractions  

## Frontend Development

### UI Style Guidelines
- Prioritise minimalist layouts; let the primary action own the page when possible.
- Keep copy tight and purposeful—avoid verbose supporting text.
- Use tiles/cards only when they clarify grouping or hierarchy.

### Current Prototype (2025-02-14)
- Landing page is a single screen: hero dropzone plus a simple “Interactive reader preview” card with the PDF mock.
- Avoid reintroducing tabs, sidebars, or heavy chrome until user feedback requires it; keep backgrounds white with light slate borders.
- Mock reader components exist for future iterations but remain unused in the live layout.

### Tech Stack (When Established)
- **Framework**: React/Next.js with TypeScript
- **Styling**: Tailwind CSS, shadcn/ui
- **State**: useState/Context for simple, Zustand for complex
- **Icons**: Lucide or Heroicons

### Directory Structure
Start simple, evolve as needed:
```
/src
  /components    # Reusable UI components
  /hooks         # Custom React hooks (when patterns emerge)
  /lib           # Utilities and helpers
  /app or /pages # Routes
```

## Development Workflow

### Common Commands
```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run test     # Run tests
npm run lint     # Check code quality (run only when asked by the user)
```

### Progress Communication
1. Clarify the task requirements
2. Outline the approach
3. Implement incrementally
4. Summarize what was completed

## Testing & Verification

### MVP Checklist
- [ ] Core feature works as intended
- [ ] No breaking errors
- [ ] Basic user flow is complete

### Production Checklist
- [ ] Tests pass
- [ ] Error handling in place
- [ ] Documentation updated
- [ ] Security considerations addressed

## Best Practices

### Start With
- Working code over perfect architecture
- Inline styles before component libraries
- Local state before state management
- Manual testing before automation

### Evolve To
- Reusable components when patterns emerge
- Proper error boundaries when stable
- Optimized performance when measured
- Comprehensive tests when validated

### Avoid
- Over-engineering before validation
- Abstractions for single-use cases
- Premature performance optimization
- Complex architecture without clear need

## Security & Deployment

### Key Considerations
- Keep sensitive data in environment variables
- Validate user inputs
- Use HTTPS in production
- Follow security best practices

### Operational Notes (Daily Digest)
- `PERPLEXITY_API_KEY` is now required for the 9AM AEST research digest; store it alongside existing secrets.
- Vercel cron runs the digest at `0 23 * * *` (UTC). Adjust if a timezone-aware scheduler becomes available for AEDT transitions.

### Documentation
- README with setup instructions
- API documentation if applicable
- Architecture decisions when relevant
- Deployment instructions
- Supabase persistence details live in `docs/supabase.md` (bucket/table schemas and policies)

## Remember
**Good code ships and works.** Start simple, iterate based on real needs, and maintain code quality without over-engineering. The best solution is often the simplest one that solves the problem.

ALWAYS UPDATE CLAUDE.md AT THE END OF EACH STEP WITH THE NEW DIRECTORY STRUCTURE AND IF NECASSARY CREATE A DOC TO GO IN DOCS WITH THE MORE DETAILS OF WHAT YOU HAVE DONE. DO NOT START NEW SERVERS THERE WILL BE ONE RUNNING YOU CAN USE FOR TESTS!!!

---

## Directory Snapshot (2025-02-14)
- `app/`
  - `(marketing)/page.tsx`
  - `layout.tsx`
  - `page.tsx`
  - `globals.css`
  - `paper/[doi]/layout.tsx`
  - `paper/[doi]/page.tsx`
  - `paper/[doi]/experts/page.tsx`
  - `paper/[doi]/patents/page.tsx`
  - `paper/[doi]/similar-papers/page.tsx`
  - `paper/[doi]/theses/page.tsx`
- `components/`
  - `annotation-sidebar.tsx`
  - `homepage-app.tsx`
  - `paper-hero.tsx`
  - `paper-reader-content.tsx`
  - `paper-tab-nav.tsx`
  - `pdf-viewer-mock.tsx`
  - `site-header.tsx`
  - `status-banner.tsx`
  - `upload-dropzone.tsx`
- `docs/`
  - `homepage-prototype.md`
- `lib/`
  - `mock-data.ts`
- `tasks/`
  - `homepage-single-app.md`
  - `sidebar-debug.md`
  - `sidebar-sidebar.md`
  - `single-page-app.md`
  - `single-page-prototype.md`
  - `v0_ui_mock.md`
- `.eslintrc.json`
- `.gitignore`
- `agents.md`
- `next-env.d.ts`
- `next.config.mjs`
- `package-lock.json`
- `package.json`
- `postcss.config.mjs`
- `tailwind.config.ts`
- `tsconfig.json`
- `tsconfig.tsbuildinfo`
- `web_archetecture.md`
- `CLAUDE.md`

## Directory Snapshot (2025-02-15)
- `app/`
  - `(marketing)/page.tsx`
  - `layout.tsx`
  - `page.tsx`
  - `paper/[doi]/layout.tsx`
  - `paper/[doi]/page.tsx`
- `components/`
  - `annotation-sidebar.tsx`
  - `homepage-app.tsx`
  - `paper-hero.tsx`
  - `paper-reader-content.tsx`
  - `paper-reader-shell.tsx`
  - `paper-tab-nav.tsx`
  - `pdf-viewer-mock.tsx`
  - `reader-sidebar.tsx`
  - `site-header.tsx`
  - `status-banner.tsx`
  - `upload-dropzone.tsx`
- `lib/mock-data.ts`
- `tasks/`
  - `single-page-sidebar-refactor.md`

## Directory Snapshot (2025-02-16)
- `app/`
  - `(marketing)/page.tsx`
  - `layout.tsx`
  - `page.tsx`
  - `paper/[doi]/layout.tsx`
  - `paper/[doi]/page.tsx`
- `components/`
  - `annotation-sidebar.tsx`
  - `homepage-app.tsx`
  - `paper-hero.tsx`
  - `paper-reader-content.tsx`
  - `paper-reader-shell.tsx`
  - `paper-tab-nav.tsx`
  - `pdf-viewer-mock.tsx`
  - `reader-sidebar.tsx`
  - `site-header.tsx`
  - `status-banner.tsx`
  - `upload-dropzone.tsx`
- `docs/`
  - `homepage-prototype.md`
- `lib/mock-data.ts`
- `tasks/`
  - `single-page-sidebar-refactor.md`
  - `sidebar-shell-plan.md`

Step 1 complete: audited navigation-related components and noted reuse candidates for the unified SPA shell.

Step 2 complete: drafted collapsible sidebar plan with main-page tab strip for review.

## Directory Snapshot (2025-02-17)
- `app/`
  - `(marketing)/page.tsx`
  - `layout.tsx`
  - `page.tsx`
  - `paper/[doi]/layout.tsx`
  - `paper/[doi]/page.tsx`
- `components/`
  - `annotation-sidebar.tsx`
  - `homepage-app.tsx`
  - `paper-hero.tsx`
  - `paper-reader-content.tsx`
  - `paper-reader-header.tsx`
  - `paper-reader-shell.tsx`
  - `paper-tab-nav.tsx`
  - `pdf-viewer-mock.tsx`
  - `reader-sidebar.tsx`
  - `site-header.tsx`
  - `status-banner.tsx`
  - `upload-dropzone.tsx`
- `docs/`
  - `homepage-prototype.md`
- `lib/mock-data.ts`
- `tasks/`
  - `reader-header.md`
  - `halo-tabs.md`
  - `single-page-sidebar-refactor.md`
  - `sidebar-shell-plan.md`

Step 3 complete: implemented collapsible sidebar shell and moved reader buttons into main content header.

Step 4 complete: implemented the halo-style horizontal reader tabs and logged the plan in `tasks/halo-tabs.md`.

Step 5 complete: consolidated the reader hero, status, and halo tabs into a single `PaperReaderHeader` and documented the plan in `tasks/reader-header.md`.

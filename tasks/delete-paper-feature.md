# Delete Paper Feature + Add Paper Enhancement

**Status:** ✅ Complete
**Date:** 2025-10-18
**Pattern:** Hover trash icon delete + instant file picker on add

## Implementation

Added clean delete functionality for library papers with minimalist hover-to-reveal UI.

### Changes Made

**1. `lib/user-papers.ts`** (lines 133-163)
- Added `DeletePaperInput` interface
- Added `deleteUserPaper()` function:
  - Deletes file from Supabase storage bucket
  - Deletes metadata from `user_papers` table
  - Gracefully handles storage deletion failures
  - Throws on database deletion errors

**2. `app/page.tsx`** (lines 15, 349-408, 448)
- Imported `deleteUserPaper` helper
- Added `handleDeletePaper()` callback:
  - Shows browser confirmation dialog
  - Optimistic UI update (removes immediately)
  - Auto-selects next paper if deleting active paper
  - Reverts on error with user feedback
  - Shows status messages via existing banner
- Passed `onDeletePaper` prop to `AppSidebar`

**3. `components/app-sidebar.tsx`** (lines 23, 34, 43, 178-226)
- Added `onDeletePaper` optional prop
- Uses inline SVG trash icon (consistent with existing codebase pattern)
- Added `hoveredPaperId` state for hover tracking
- Updated paper list rendering:
  - Trash icon appears on hover (non-collapsed only)
  - Positioned absolutely on right side
  - Click stops propagation (doesn't select paper)
  - Styling adapts to active/inactive state
  - Added `pr-8` padding to paper names to prevent text overlap

## UI Behavior

- **Active paper styling**: Black background with white text (consistent in both collapsed/expanded states)
- **Hover**: Trash icon fades in on right side of paper item
  - Active papers: White icon (70% opacity) → full white on hover with subtle white background
  - Inactive papers: Gray icon → red on hover with red background tint
- **Click**: Browser confirm dialog → optimistic deletion → Supabase cleanup
- **Active paper deleted**: Auto-selects first remaining paper
- **Last paper deleted**: Shows upload dropzone
- **Error handling**: Reverts deletion + shows error in status banner
- **Collapsed sidebar**: Delete icon hidden (clean collapsed state)

## Edge Cases Handled

✅ Deleting active paper → auto-select next
✅ Deleting last paper → show upload dropzone
✅ Storage deletion fails → still deletes DB record (logged)
✅ DB deletion fails → reverts optimistic update + shows error
✅ No user/no Supabase → function returns early
✅ Hover on collapsed sidebar → no trash icon shown

## Testing Checklist

- [ ] Upload multiple papers
- [ ] Hover over paper → trash icon appears
- [ ] Click trash → confirm dialog appears
- [ ] Confirm delete → paper removed from UI
- [ ] Verify paper deleted from Supabase (storage + DB)
- [ ] Delete active paper → next paper auto-selected
- [ ] Delete last paper → upload dropzone shown
- [ ] Test with network offline → error handling
- [ ] Collapse sidebar → trash icons hidden
- [ ] Expand sidebar → trash icons work again

## Code Quality

- Follows existing patterns from codebase
- Uses optimistic UI updates for snappy UX
- Proper TypeScript types for all new code
- Accessible with aria-labels
- Clean hover states with Tailwind transitions
- Minimal code (~60 lines total)
- No new dependencies (uses inline SVG like rest of codebase)

## Add Paper Button Enhancement

**Added:** 2025-10-18

Enhanced the "Add paper" button in the sidebar to provide a seamless upload experience.

### Implementation

**`app/page.tsx`** (lines 170, 525-532, 624-639)
- Added `fileInputRef` to reference a hidden file input
- Updated `handleShowUpload()` to trigger file picker after navigating to upload page
- Added hidden `<input type="file">` that calls `handlePaperUpload()` on file selection

### Behavior

When user clicks "Add paper" button:
1. ✅ Navigates to upload page (shows dropzone)
2. ✅ Immediately opens system file picker
3. ✅ User selects PDF → uploads automatically
4. ✅ Smooth UX - no need to click dropzone after

This creates a **single-click upload flow** while maintaining the visual consistency of showing the upload page.

## Future Enhancements (NOT implemented)

- Custom confirmation modal for delete (currently uses browser `confirm()`)
- Undo deletion with toast + timer
- Bulk delete (select multiple papers)
- Keyboard shortcut (Delete key)
- Soft delete with trash bin

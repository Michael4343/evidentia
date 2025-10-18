# PDF Upload Error Tracking

**Status**: ✅ Complete
**Date**: 2025-10-18

## Problem
Two different error messages were appearing for PDF uploads:
1. Small text message below upload dropzone
2. Top banner message

Both showed generic errors that didn't explain the actual issue to users (e.g., "We could not save your paper. Please try again.").

## Solution
Consolidated error handling into a single, clear banner with specific, actionable error messages.

### Changes Made

#### 1. Created Error Parser Utility (`lib/upload-errors.ts`)
- Parses Supabase errors into user-friendly messages
- Handles specific error types:
  - Storage quota errors
  - Network/connection errors
  - Authentication/session errors
  - Storage bucket errors
  - Database errors
- Includes file size validation (50MB limit)

#### 2. Updated Main Page (`app/page.tsx`)
- **Removed duplicate error display** from `PaperTabContent` component
- **Added dismiss functionality** to status banner:
  - New state: `isStatusDismissed`
  - Dismiss button (×) on banner
  - Auto-resets on new upload
- **Enhanced error handling**:
  - File size validation before upload starts
  - Specific error messages using `parseUploadError()`
  - Applied to both upload and library fetch operations

#### 3. Banner Improvements
- Single source of truth for status messages
- Dismissible with × button
- Color-coded: red for errors, slate for info
- Responsive layout with proper spacing

### User Experience Improvements

**Before:**
- "We could not save your paper. Please try again."

**After:**
- "File is too large (75.3MB). Maximum size is 50MB."
- "Connection lost. Check your internet and try again."
- "Session expired. Please sign in again."
- "Storage limit reached. Please contact support to increase your quota."

## Files Modified
- `lib/upload-errors.ts` (new)
- `app/page.tsx`

## Technical Notes
- Error parser checks for specific error patterns in messages and status codes
- File size validation happens client-side before any API calls
- Banner state resets automatically on new uploads
- All error handling uses the same parser for consistency

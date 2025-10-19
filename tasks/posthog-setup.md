# PostHog Analytics Setup

## Goal
Implement basic PostHog tracking for production only with session recordings enabled.

## Implementation

### 1. Environment Variables
- Uncommented PostHog keys in `.env.production`:
  - `NEXT_PUBLIC_POSTHOG_KEY`
  - `NEXT_PUBLIC_POSTHOG_HOST`

### 2. PostHog Provider (`lib/posthog-provider.tsx`)
- Created client-side provider that:
  - Only initializes in production (checks `NODE_ENV === 'production'`)
  - Enables session recordings with cross-origin iframe support
  - Captures console logs for debugging
  - Auto-tracks pageviews on route changes
  - Does NOT track in localhost/dev environment

### 3. Root Layout Integration
- Wrapped app in `PostHogProvider` in `app/layout.tsx`
- Provider wraps `AuthModalProvider` to track all user activity

### 4. Authentication Tracking
Added event tracking in `components/auth-modal-provider.tsx`:

#### Events Captured:
- `user_login` - When user successfully logs in (email or Google)
  - Properties: `user_id`, `email`
- `user_signup` - When user signs up with email
  - Properties: `email`, `method: 'email'`
- `user_signup_initiated` - When user clicks Google signup
  - Properties: `method: 'google'`
- `user_login_initiated` - When user clicks Google login
  - Properties: `method: 'google'`

#### User Identification:
- Users are identified with PostHog using their Supabase user ID
- Email is attached to user profile for session recordings
- Identification happens on both `SIGNED_IN` and `INITIAL_SESSION` events

### 5. Automatic Tracking
PostHog automatically captures:
- Page views (via provider's route change listener)
- Session recordings (enabled in PostHog settings)
- Console logs
- Network performance (if enabled in PostHog dashboard)

## What's Tracked in Production
✅ Page visits (automatic)
✅ Login events
✅ Signup events
✅ Session recordings
✅ User identification
✅ Console logs

## What's NOT Tracked
❌ Localhost development environment
❌ Any activity when `NODE_ENV !== 'production'`

## Testing
To verify tracking works:
1. Deploy to production (Vercel)
2. Visit https://evidentia-swart.vercel.app/
3. Log in or sign up
4. Check PostHog dashboard for events and session recordings

## Next Steps (Optional)
- Add custom events for key user actions (e.g., paper uploads, tab switches)
- Configure session recording settings in PostHog dashboard
- Set up funnels or insights in PostHog for user journey analysis

'use client'

import { Suspense, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'

function PostHogPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Track pageview on route change
  useEffect(() => {
    if (pathname && process.env.NODE_ENV === 'production') {
      let url = window.origin + pathname
      if (searchParams && searchParams.toString()) {
        url = url + `?${searchParams.toString()}`
      }
      posthog.capture('$pageview', {
        $current_url: url,
      })
    }
  }, [pathname, searchParams])

  return null
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Only initialize PostHog in production with valid keys
    const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
    const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST

    if (posthogKey && posthogHost && process.env.NODE_ENV === 'production') {
      posthog.init(posthogKey, {
        api_host: posthogHost,
        // Enable session recordings
        session_recording: {
          recordCrossOriginIframes: true,
        },
        // Auto-capture pageviews
        capture_pageview: true,
        // Capture console logs for debugging
        enable_recording_console_log: true,
        // Load PostHog on initialization
        loaded: (posthog) => {
          if (process.env.NODE_ENV === 'development') posthog.debug()
        },
      })
    }
  }, [])

  return (
    <>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </>
  )
}

'use client';

import { ClerkProvider, useAuth } from '@clerk/nextjs';
import { ConvexReactClient } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { useMemo } from 'react';

/**
 * Until NEXT_PUBLIC_CONVEX_URL and the Clerk publishable key are configured
 * (Phase 0 checklist), the app renders without providers so the skeleton page
 * still works. Both are required from Phase 1 on.
 */
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function Providers({ children }: { children: React.ReactNode }) {
  const convex = useMemo(
    () => (convexUrl !== undefined && convexUrl !== '' ? new ConvexReactClient(convexUrl) : null),
    [],
  );

  if (!clerkConfigured || convex === null) {
    return <>{children}</>;
  }

  return (
    <ClerkProvider>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

'use client';

import Link from 'next/link';
import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react';
import { BottomNav } from '@/components/bottom-nav';
import { EnsureUser } from '@/components/ensure-user';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col">
      <AuthLoading>
        <div className="flex-1 space-y-3 p-6" aria-hidden>
          <div className="h-4 w-2/3 rounded-control bg-ink-faint" />
          <div className="h-4 w-1/2 rounded-control bg-ink-faint" />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <main className="flex flex-1 items-center justify-center p-6">
          <Link href="/sign-in" className="text-body text-meridian" data-testid="go-sign-in">
            Sign in to open Atlas
          </Link>
        </main>
      </Unauthenticated>
      <Authenticated>
        <EnsureUser>
          <main className="flex-1 overflow-x-clip overflow-y-auto">{children}</main>
        </EnsureUser>
      </Authenticated>
      <BottomNav />
    </div>
  );
}

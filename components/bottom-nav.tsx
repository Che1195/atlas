'use client';

import { useConvexAuth, useQuery } from 'convex/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '@/convex/_generated/api';

const TABS = [
  { href: '/capture', label: 'Capture', testid: 'nav-capture' },
  { href: '/knowledge', label: 'Knowledge', testid: 'nav-knowledge' },
  { href: '/review', label: 'Review', testid: 'nav-review' },
  { href: '/more', label: 'More', testid: 'nav-more' },
] as const;

/** Static flex child, never `fixed` (playbook iOS rule). */
export function BottomNav() {
  const pathname = usePathname();
  const { isAuthenticated } = useConvexAuth();
  const pendingCount = useQuery(api.proposals.pendingCount, isAuthenticated ? {} : 'skip');

  return (
    <nav className="flex border-t border-ink-faint bg-surface" aria-label="Primary">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            data-testid={tab.testid}
            className={`fade-state flex-1 py-3 text-center text-meta ${
              active ? 'font-medium text-meridian' : 'text-ink-muted'
            }`}
          >
            {tab.label}
            {tab.href === '/review' && pendingCount !== undefined && pendingCount > 0 && (
              <span data-testid="nav-review-count"> · {pendingCount}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

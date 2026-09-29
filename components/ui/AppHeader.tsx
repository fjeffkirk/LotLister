'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from './Logo';
import { AccountMenu } from './AccountMenu';
import { useCommandPalette } from '../CommandPalette';
import { SearchIcon } from './icons';

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const path = usePathname();
  const active = href === '/lots' ? path === '/lots' : path.startsWith(href);
  return (
    <Link
      href={href}
      className={`px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
        active ? 'text-white bg-white/[0.06]' : 'text-surface-400 hover:text-surface-100'
      }`}
    >
      {children}
    </Link>
  );
}

/** Sticky glass header shared by the dashboard, settings, and import pages. */
export function AppHeader({ actions, maxWidth = 'max-w-7xl' }: { actions?: ReactNode; maxWidth?: string }) {
  const { open } = useCommandPalette();
  return (
    <header className="glass sticky top-0 z-30 border-b border-white/[0.06]">
      <div className={`${maxWidth} mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3`}>
        <div className="flex items-center gap-4 min-w-0">
          <Logo />
          <nav className="hidden sm:flex items-center gap-0.5">
            <NavLink href="/lots">Dashboard</NavLink>
            <NavLink href="/ops/orders">Orders</NavLink>
            <NavLink href="/ops/inventory">Inventory</NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={open}
            className="hidden md:flex items-center gap-2 w-60 h-9 px-3 rounded-lg border border-white/[0.08] bg-white/[0.03] text-sm text-surface-500 hover:text-surface-300 hover:border-white/[0.14] transition-colors"
          >
            <SearchIcon size={15} />
            <span className="flex-1 text-left truncate whitespace-nowrap">Search or jump to…</span>
            <kbd className="kbd">Ctrl K</kbd>
          </button>
          <button onClick={open} className="md:hidden btn btn-ghost btn-icon" aria-label="Search">
            <SearchIcon size={18} />
          </button>
          <AccountMenu />
          {actions}
        </div>
      </div>
    </header>
  );
}

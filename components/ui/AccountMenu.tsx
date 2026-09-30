'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '../UserProvider';
import { Dropdown } from './Dropdown';
import { CheckCircleIcon, DatabaseIcon, GearIcon, LogOutIcon } from './icons';

interface StorageInfo {
  usedMB: number;
  maxGB: number;
  percentUsed: number;
}

export function Avatar({ name, size = 32 }: { name: string | null; size?: number }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold text-white ring-1 ring-white/15 flex-shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        backgroundImage: 'linear-gradient(135deg, #4a76fb 0%, #8347f5 100%)',
      }}
    >
      {initial}
    </span>
  );
}

/** Avatar button holding the account, storage, lifetime stats, settings, and sign-out. */
export function AccountMenu() {
  const { username, signOut } = useUser();
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [completedCount, setCompletedCount] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    fetch('/api/storage')
      .then((res) => res.json())
      .then((data) => data.success && setStorage(data.data))
      .catch(() => undefined);
    fetch('/api/user')
      .then((res) => res.json())
      .then((data) => data.success && setCompletedCount(data.data.completedCount))
      .catch(() => undefined);
  }, [loaded]);

  const storageTone =
    !storage ? 'bg-primary-500' : storage.percentUsed > 90 ? 'bg-red-500' : storage.percentUsed > 70 ? 'bg-amber-500' : 'bg-primary-500';

  return (
    <Dropdown
      menuClassName="w-72"
      trigger={({ open, toggle }) => (
        <button
          onClick={() => {
            setLoaded(true);
            toggle();
          }}
          className={`flex items-center gap-2 rounded-full pl-1 pr-1 sm:pr-3 py-1 border transition-colors ${
            open ? 'border-white/20 bg-white/[0.06]' : 'border-transparent hover:bg-white/[0.05]'
          }`}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Avatar name={username} size={28} />
          <span className="hidden sm:block max-w-[140px] truncate text-sm text-surface-200">{username}</span>
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-center gap-3 px-2.5 pt-2 pb-3">
            <Avatar name={username} size={38} />
            <div className="min-w-0">
              <div className="text-sm font-medium text-white truncate">{username}</div>
              <div className="text-xs text-surface-400">eBay seller account</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 px-1.5 pb-2">
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-2.5 py-2">
              <div className="flex items-center gap-1.5 text-[11px] text-surface-400">
                <CheckCircleIcon size={12} /> Completed
              </div>
              <div className="text-base font-semibold text-white tabular-nums mt-0.5">{completedCount ?? '—'}</div>
            </div>
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-2.5 py-2" title={storage ? `${storage.usedMB} MB of ${storage.maxGB} GB` : undefined}>
              <div className="flex items-center gap-1.5 text-[11px] text-surface-400">
                <DatabaseIcon size={12} /> Storage
              </div>
              <div className="text-base font-semibold text-white tabular-nums mt-0.5">{storage ? `${storage.percentUsed}%` : '—'}</div>
              <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
                <div className={`h-full rounded-full ${storageTone} transition-all duration-500`} style={{ width: `${storage?.percentUsed ?? 0}%` }} />
              </div>
            </div>
          </div>
          <div className="menu-divider" />
          <Link href="/settings" onClick={close} className="menu-item">
            <GearIcon className="text-surface-400" /> Settings
          </Link>
          <div className="menu-divider" />
          <button onClick={signOut} className="menu-item text-red-300 hover:text-red-200">
            <LogOutIcon /> Sign out
          </button>
        </>
      )}
    </Dropdown>
  );
}

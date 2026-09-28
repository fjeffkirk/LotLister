'use client';

import { ReactNode, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from './UserProvider';

// eBay links to the privacy page from its consent screen, so it must stay public.
const PUBLIC_PATHS = ['/privacy'];

export function SignInGate({ children }: { children: ReactNode }) {
  const { username, isLoading } = useUser();
  const pathname = usePathname();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('signin') === 'error') {
      setError(params.get('message') || 'eBay sign-in failed.');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('ebay') === 'declined') {
      setError('eBay sign-in was cancelled.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  if (PUBLIC_PATHS.includes(pathname)) return <>{children}</>;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950 flex items-center justify-center">
        <div className="spinner w-8 h-8"></div>
      </div>
    );
  }

  if (username) return <>{children}</>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950 flex items-center justify-center p-4">
      <div className="bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-full max-w-md p-6 sm:p-8 animate-slide-up text-center">
        <div className="flex items-center justify-center gap-2 sm:gap-3 mb-5 sm:mb-6">
          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-primary-500 to-primary-700 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 sm:w-7 sm:h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-primary-400 to-primary-200 bg-clip-text text-transparent">
            LotLister
          </h1>
        </div>

        <p className="text-surface-400 text-sm mb-6">
          Sign in with your eBay account. Your lots are tied to it, and listings go to that seller account.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm text-left">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            window.location.href = '/api/ebay/connect';
          }}
          className="btn btn-primary w-full py-3"
        >
          Sign in with eBay
        </button>
      </div>
    </div>
  );
}

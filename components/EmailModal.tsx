'use client';

import { useState } from 'react';
import { useUser } from './UserProvider';

export function EmailModal() {
  const { userEmail, setUserEmail, isLoading } = useUser();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  // Don't show modal if loading or user already has email
  if (isLoading || userEmail) {
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmedEmail = email.trim().toLowerCase();
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    setUserEmail(trimmedEmail);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in p-4">
      <div className="bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-full max-w-md p-6 sm:p-8 animate-slide-up">
        {/* Logo */}
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

        <div className="text-center mb-5 sm:mb-6">
          <h2 className="text-lg sm:text-xl font-semibold text-surface-100 mb-2">Welcome!</h2>
          <p className="text-surface-400 text-xs sm:text-sm">
            Enter your email address to access your workspace. Your data is tied to this email.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="email" className="block text-sm font-medium text-surface-300 mb-2">
              Email Address
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full px-4 py-3 bg-surface-800 border border-surface-600 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              autoFocus
              autoComplete="email"
            />
            {error && (
              <p className="mt-2 text-sm text-red-400">{error}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={!email.trim()}
            className="btn btn-primary w-full py-3"
          >
            Continue to My Workspace
          </button>
        </form>

        <p className="mt-6 text-xs text-surface-500 text-center">
          Your email is only used to identify your workspace. No account or password required.
        </p>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '../../components/UserProvider';

interface EbaySettings {
  configured: boolean;
  missingEnvVars: string[];
  imagesReachable: boolean;
  callbackUrl: string;
  privacyUrl: string;
  declinedUrl: string;
}

export default function SettingsPage() {
  const { username, signOut } = useUser();
  const [settings, setSettings] = useState<EbaySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/ebay/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setSettings(data.data as EbaySettings);
        else setError(data.error || 'Failed to load eBay settings');
      })
      .catch(() => setError('Failed to load eBay settings'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950">
      <header className="border-b border-surface-800 bg-surface-950/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
          <Link href="/lots" className="text-sm text-surface-400 hover:text-surface-200">
            ← Lots
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold mt-1">eBay</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {error && (
          <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">{error}</div>
        )}

        <section className="p-5 rounded-xl border border-surface-700 bg-surface-900/60 space-y-3">
          <h2 className="font-medium text-surface-100">Your account</h2>
          <p className="text-sm text-surface-400 leading-6">
            Signed in with eBay as <span className="text-surface-100">{username}</span>. Listings are created on this
            seller account.
          </p>
          <button type="button" onClick={signOut} className="btn btn-secondary text-sm">
            Sign out
          </button>
        </section>

        {loading ? (
          <div className="py-8 flex justify-center">
            <div className="spinner w-8 h-8"></div>
          </div>
        ) : settings ? (
          <>
            {!settings.configured && (
              <section className="p-5 rounded-xl border border-amber-700/60 bg-amber-900/20 space-y-2">
                <h2 className="font-medium text-amber-200">eBay is not fully configured on the server</h2>
                <ul className="text-sm font-mono text-amber-100 space-y-1">
                  {settings.missingEnvVars.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </section>
            )}
            {!settings.imagesReachable && (
              <p className="text-sm text-amber-300 leading-6">
                This site is not on a public https address, so eBay cannot download card photos. Listing only works from
                the deployed site with NEXT_PUBLIC_APP_URL set.
              </p>
            )}

            <section className="p-5 rounded-xl border border-surface-700 bg-surface-900/60 space-y-3">
              <h2 className="font-medium text-surface-100">RuName URLs</h2>
              <p className="text-sm text-surface-400 leading-6">
                These are the addresses configured on the production RuName in the eBay developer portal.
              </p>
              <UrlRow label="Auth accepted URL" value={settings.callbackUrl} />
              <UrlRow label="Auth declined URL" value={settings.declinedUrl} />
              <UrlRow label="Privacy policy URL" value={settings.privacyUrl} />
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

function UrlRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-surface-400 mb-1">{label}</div>
      <code className="block text-xs sm:text-sm break-all bg-surface-950 border border-surface-700 rounded-lg px-3 py-2 text-surface-200">
        {value}
      </code>
    </div>
  );
}

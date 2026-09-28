'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '../../components/UserProvider';

interface EbaySettings {
  configured: boolean;
  missingEnvVars: string[];
  connected: boolean;
  ebayUserId: string | null;
  publicBaseUrl: string;
  imagesReachable: boolean;
  callbackUrl: string;
  privacyUrl: string;
  declinedUrl: string;
}

export default function SettingsPage() {
  const { userEmail, isLoading: userLoading } = useUser();
  const [settings, setSettings] = useState<EbaySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ebay = params.get('ebay');
    if (ebay === 'connected') setNotice('eBay account connected.');
    if (ebay === 'declined') setError('eBay authorization was declined.');
    if (ebay === 'error') setError(params.get('message') || 'eBay connection failed.');
    if (ebay) window.history.replaceState({}, '', '/settings');
  }, []);

  useEffect(() => {
    if (userEmail) {
      loadSettings();
    } else if (!userLoading) {
      setLoading(false);
    }
  }, [userEmail, userLoading]);

  async function loadSettings() {
    setLoading(true);
    try {
      const res = await fetch('/api/ebay/settings');
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to load eBay settings');
        return;
      }
      setSettings(data.data as EbaySettings);
    } catch {
      setError('Failed to load eBay settings');
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/ebay/disconnect', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to disconnect eBay');
        return;
      }
      setNotice('eBay account disconnected.');
      await loadSettings();
    } catch {
      setError('Failed to disconnect eBay');
    } finally {
      setDisconnecting(false);
    }
  }

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
        {notice && (
          <div className="p-4 bg-green-900/30 border border-green-700 rounded-lg text-green-300 text-sm">{notice}</div>
        )}

        {loading ? (
          <div className="py-8 flex justify-center">
            <div className="spinner w-8 h-8"></div>
          </div>
        ) : settings ? (
          <>
            {!settings.configured && (
              <section className="p-5 rounded-xl border border-amber-700/60 bg-amber-900/20 space-y-2">
                <h2 className="font-medium text-amber-200">eBay is not configured on the server</h2>
                <p className="text-sm text-amber-100/80 leading-6">
                  Set these environment variables on the server, then redeploy:
                </p>
                <ul className="text-sm font-mono text-amber-100 space-y-1">
                  {settings.missingEnvVars.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </section>
            )}

            <section className="p-5 rounded-xl border border-surface-700 bg-surface-900/60 space-y-3">
              <h2 className="font-medium text-surface-100">Your eBay account</h2>
              <p className="text-sm text-surface-400 leading-6">
                Connecting signs you into eBay so LotLister can create listings on your seller account.
              </p>
              {settings.connected ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-green-300">
                    Connected{settings.ebayUserId ? ` as ${settings.ebayUserId}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    className="btn btn-secondary text-sm"
                  >
                    {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!settings.configured}
                  onClick={() => {
                    window.location.href = '/api/ebay/connect';
                  }}
                  className="btn btn-primary"
                >
                  Connect eBay account
                </button>
              )}
              {!settings.imagesReachable && (
                <p className="text-sm text-amber-300 leading-6">
                  This site is not on a public https address, so eBay cannot download card photos. Listing only works
                  from the deployed site with NEXT_PUBLIC_APP_URL set.
                </p>
              )}
            </section>

            <section className="p-5 rounded-xl border border-surface-700 bg-surface-900/60 space-y-3">
              <h2 className="font-medium text-surface-100">RuName URLs</h2>
              <p className="text-sm text-surface-400 leading-6">
                When creating the production RuName in the eBay developer portal, paste these addresses.
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

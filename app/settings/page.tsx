'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '../../components/UserProvider';
import { AppHeader } from '../../components/ui/AppHeader';
import { Avatar } from '../../components/ui/AccountMenu';
import { AlertIcon, CheckCircleIcon, ChevronDownIcon, ChevronLeftIcon, CopyIcon, LogOutIcon } from '../../components/ui/icons';

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

  const listingReady = Boolean(settings?.configured && settings.imagesReachable);

  return (
    <div className="min-h-screen">
      <AppHeader maxWidth="max-w-3xl" />

      <main className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">
        <div>
          <Link href="/lots" className="inline-flex items-center gap-1 text-sm text-surface-400 hover:text-surface-200">
            <ChevronLeftIcon size={14} /> Dashboard
          </Link>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-white">Account</h1>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3.5 bg-red-500/10 border border-red-500/30 rounded-xl text-red-200 text-sm">
            <AlertIcon /> {error}
          </div>
        )}

        <section className="panel p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <Avatar name={username} size={52} />
          <div className="flex-1 min-w-0">
            <div className="text-lg font-semibold text-white truncate">{username}</div>
            <p className="text-sm text-surface-400">Signed in with eBay. Listings are created on this seller account.</p>
          </div>
          <button type="button" onClick={signOut} className="btn btn-secondary">
            <LogOutIcon /> Sign out
          </button>
        </section>

        <section className="panel p-5 sm:p-6">
          <h2 className="font-semibold text-white">eBay listing</h2>
          {loading ? (
            <div className="mt-4 space-y-2">
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-4 w-1/2" />
            </div>
          ) : settings ? (
            <div className="mt-4 space-y-3">
              <StatusRow ok={settings.configured} okText="eBay keys are set on the server" badText="eBay isn't fully set up on the server yet" />
              <StatusRow
                ok={settings.imagesReachable}
                okText="Card photos are reachable by eBay"
                badText="eBay can't download photos from this address. Listing only works from the deployed site."
              />
              {!listingReady && (
                <p className="text-xs text-surface-500 pt-1">Details for whoever runs the server are under Advanced below.</p>
              )}
            </div>
          ) : null}
        </section>

        {settings && (
          <details className="panel group">
            <summary className="flex items-center justify-between gap-3 p-5 sm:px-6 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
              <span>
                <span className="block font-semibold text-white">Advanced</span>
                <span className="block text-sm text-surface-400">Server configuration and eBay developer portal addresses</span>
              </span>
              <ChevronDownIcon className="text-surface-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-5 sm:px-6 pb-6 space-y-5 border-t border-white/[0.06] pt-5">
              {settings.missingEnvVars.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-amber-300 mb-2">Missing environment variables</div>
                  <div className="flex flex-wrap gap-1.5">
                    {settings.missingEnvVars.map((name) => (
                      <code key={name} className="chip chip-warn font-mono">{name}</code>
                    ))}
                  </div>
                </div>
              )}
              {!settings.imagesReachable && (
                <p className="text-sm text-surface-400 leading-6">
                  Set <code className="font-mono text-surface-200">NEXT_PUBLIC_APP_URL</code> to the public https address so eBay can fetch card photos.
                </p>
              )}
              <div className="space-y-3">
                <p className="text-sm text-surface-400">These addresses are configured on the production RuName in the eBay developer portal.</p>
                <UrlRow label="Auth accepted URL" value={settings.callbackUrl} />
                <UrlRow label="Auth declined URL" value={settings.declinedUrl} />
                <UrlRow label="Privacy policy URL" value={settings.privacyUrl} />
              </div>
            </div>
          </details>
        )}
      </main>
    </div>
  );
}

function StatusRow({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 ${ok ? 'text-emerald-300' : 'text-amber-300'}`}>{ok ? <CheckCircleIcon size={18} /> : <AlertIcon size={18} />}</span>
      <span className={`text-sm ${ok ? 'text-surface-200' : 'text-amber-100'}`}>{ok ? okText : badText}</span>
    </div>
  );
}

function UrlRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="text-xs font-medium text-surface-400 mb-1.5">{label}</div>
      <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-surface-950/60 pl-3 pr-1 py-1">
        <code className="flex-1 text-xs sm:text-sm break-all font-mono text-surface-200">{value}</code>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="btn btn-ghost btn-sm"
          title="Copy"
        >
          {copied ? <CheckCircleIcon size={14} className="text-emerald-300" /> : <CopyIcon size={14} />}
        </button>
      </div>
    </div>
  );
}

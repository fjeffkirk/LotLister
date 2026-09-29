'use client';

import { useEffect, useState } from 'react';
import { AlertIcon, CheckCircleIcon, RotateIcon } from '../ui/icons';

export function ShopifySettings() {
  const [shop, setShop] = useState('');
  const [connected, setConnected] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [sync, test] = await Promise.all([
      fetch('/api/sync', { cache: 'no-store' }).then((res) => res.json()).catch(() => null),
      fetch('/api/shopify/test', { cache: 'no-store' }).then((res) => res.json()).catch(() => null),
    ]);
    setLastSync(sync?.lastSuccessfulSyncAt ?? null);
    if (test?.shopName || test?.shop) setConnected(test.shopName || test.shop);
    else if (test?.error) setConnected(null);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function startSync(full = false) {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/sync?${full ? 'full=1&' : ''}force=1`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Sync failed');
      setMessage(body.message || 'Sync started');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section id="shopify" className="panel p-5 sm:p-6 scroll-mt-24">
      <h2 className="font-semibold text-white">Shopify store</h2>
      <p className="mt-1 text-sm text-surface-400">
        Store sales and inventory on the dashboard. This does not change eBay listing.
      </p>

      <div className="mt-4 space-y-3">
        <StatusRow
          ok={Boolean(connected)}
          okText={connected ? `Connected to ${connected}` : 'Connected'}
          badText="Shopify is not connected yet"
        />
        {lastSync && (
          <p className="text-xs text-surface-500">
            Last sync {new Date(lastSync).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </p>
        )}
      </div>

      <form
        className="mt-5 flex flex-col sm:flex-row gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const domain = shop.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
          if (!domain) return;
          window.location.href = `/api/shopify/auth?shop=${encodeURIComponent(domain)}`;
        }}
      >
        <input
          value={shop}
          onChange={(event) => setShop(event.target.value)}
          placeholder="your-store.myshopify.com"
          className="flex-1"
          autoComplete="off"
        />
        <button type="submit" className="btn btn-secondary">Connect Shopify</button>
      </form>
      <p className="mt-2 text-xs text-surface-500">
        Needs SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET on Render, or a store custom-app token in env.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => startSync(false)} disabled={syncing} className="btn btn-primary btn-sm">
          {syncing ? <RotateIcon size={14} className="animate-spin [animation-direction:reverse]" /> : null}
          Sync now
        </button>
        <button type="button" onClick={() => startSync(true)} disabled={syncing} className="btn btn-ghost btn-sm">
          Full resync
        </button>
      </div>
      {message && <p className="mt-3 text-sm text-emerald-300">{message}</p>}
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </section>
  );
}

function StatusRow({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 ${ok ? 'text-emerald-300' : 'text-amber-300'}`}>
        {ok ? <CheckCircleIcon size={18} /> : <AlertIcon size={18} />}
      </span>
      <span className={`text-sm ${ok ? 'text-surface-200' : 'text-amber-100'}`}>{ok ? okText : badText}</span>
    </div>
  );
}

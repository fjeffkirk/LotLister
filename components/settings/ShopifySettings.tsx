'use client';

import { useEffect, useState } from 'react';
import { AlertIcon, CheckCircleIcon, RotateIcon } from '../ui/icons';
import { ProductMargins } from './ProductMargins';

type SyncMode = 'manual' | 'polling' | 'webhook_ready';

type OpsSettings = {
  shopifyShopDomain: string | null;
  shopifyShopName: string | null;
  lastSuccessfulSyncAt: string | null;
  defaultMarginPercent: number;
  lowStockDefaultThreshold: number;
  defaultReorderQuantity: number;
  averageFreeShippingCost: number;
  pollingIntervalMinutes: number;
  syncMode: SyncMode;
};

const DEFAULTS: OpsSettings = {
  shopifyShopDomain: null,
  shopifyShopName: null,
  lastSuccessfulSyncAt: null,
  defaultMarginPercent: 35,
  lowStockDefaultThreshold: 5,
  defaultReorderQuantity: 2,
  averageFreeShippingCost: 15,
  pollingIntervalMinutes: 10,
  syncMode: 'polling',
};

export function ShopifySettings() {
  const [shop, setShop] = useState('');
  const [ops, setOps] = useState<OpsSettings>(DEFAULTS);
  const [connected, setConnected] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [sync, test, settings] = await Promise.all([
      fetch('/api/sync', { cache: 'no-store' }).then((res) => res.json()).catch(() => null),
      fetch('/api/shopify/test', { cache: 'no-store' }).then((res) => (res.ok ? res.json() : null)).catch(() => null),
      fetch('/api/shopify/settings', { cache: 'no-store' }).then((res) => res.json()).catch(() => null),
    ]);
    const row = settings?.settings as OpsSettings | null | undefined;
    if (row) {
      setOps({ ...DEFAULTS, ...row, syncMode: row.syncMode || 'polling' });
    }
    if (sync?.lastSuccessfulSyncAt) {
      setOps((current) => ({ ...current, lastSuccessfulSyncAt: sync.lastSuccessfulSyncAt }));
    }
    if (test?.shopName || test?.shop) setConnected(test.shopName || test.shop);
    else if (row?.shopifyShopName || row?.shopifyShopDomain) setConnected(row.shopifyShopName || row.shopifyShopDomain);
    else setConnected(null);
  }

  useEffect(() => {
    refresh();
  }, []);

  const domain = ops.shopifyShopDomain || '';

  function goAuthorize(raw: string) {
    const next = raw.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!next) return;
    window.location.href = `/api/shopify/auth?shop=${encodeURIComponent(next)}`;
  }

  async function startSync(full = false) {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/sync?${full ? 'full=1&' : ''}force=1`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Sync failed');
      setMessage(body.message || (full ? 'Full resync started' : 'Sync started'));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function saveOps(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/shopify/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultMarginPercent: ops.defaultMarginPercent,
          lowStockDefaultThreshold: ops.lowStockDefaultThreshold,
          defaultReorderQuantity: ops.defaultReorderQuantity,
          averageFreeShippingCost: ops.averageFreeShippingCost,
          pollingIntervalMinutes: ops.syncMode === 'manual' ? 0 : ops.pollingIntervalMinutes,
          syncMode: ops.syncMode,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.ok === false) throw new Error(body?.error || 'Could not save settings');
      setMessage('Shopify settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="shopify" className="panel p-5 sm:p-6 scroll-mt-24 space-y-6">
      <div>
        <h2 className="font-semibold text-white">Shopify store</h2>
        <p className="mt-1 text-sm text-surface-400">
          Store sales, ad spend, and inventory on the dashboard. This does not change eBay listing.
        </p>
      </div>

      <div className="space-y-3">
        <StatusRow
          ok={Boolean(connected)}
          okText={connected ? `Connected to ${connected}` : 'Connected'}
          badText="Shopify is not connected yet"
        />
        {domain && <p className="text-xs text-surface-500">{domain}</p>}
        {ops.lastSuccessfulSyncAt && (
          <p className="text-xs text-surface-500">
            Last sync {new Date(ops.lastSuccessfulSyncAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {domain ? (
          <button type="button" onClick={() => goAuthorize(domain)} className="btn btn-primary btn-sm">
            Re-authorize with Shopify
          </button>
        ) : null}
        <button type="button" onClick={() => startSync(false)} disabled={syncing} className="btn btn-secondary btn-sm">
          {syncing ? <RotateIcon size={14} className="animate-spin [animation-direction:reverse]" /> : null}
          Sync now
        </button>
        <button type="button" onClick={() => startSync(true)} disabled={syncing} className="btn btn-secondary btn-sm">
          Full resync
        </button>
      </div>

      <form
        className="flex flex-col sm:flex-row gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          goAuthorize(shop);
        }}
      >
        <input
          value={shop}
          onChange={(event) => setShop(event.target.value)}
          placeholder="your-store.myshopify.com"
          className="flex-1"
          autoComplete="off"
          aria-label="Shopify store domain"
        />
        <button type="submit" className="btn btn-secondary">{domain ? 'Connect a different store' : 'Connect Shopify'}</button>
      </form>
      <p className="-mt-3 text-xs text-surface-500">
        Needs SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET on Render, or a store custom-app token in env.
      </p>

      <form onSubmit={saveOps} className="grid gap-4 sm:grid-cols-2">
        <h3 className="sm:col-span-2 text-sm font-medium text-white">Margins and sync</h3>
        <label className="text-xs text-surface-400">
          Default margin %
          <input
            type="number"
            min="0"
            max="99.99"
            step="0.1"
            value={ops.defaultMarginPercent}
            onChange={(event) => setOps((current) => ({ ...current, defaultMarginPercent: Number(event.target.value) }))}
            className="mt-1 block w-full"
          />
        </label>
        <label className="text-xs text-surface-400">
          Low stock threshold (units)
          <input
            type="number"
            min="0"
            step="1"
            value={ops.lowStockDefaultThreshold}
            onChange={(event) => setOps((current) => ({ ...current, lowStockDefaultThreshold: Number(event.target.value) }))}
            className="mt-1 block w-full"
          />
        </label>
        <label className="text-xs text-surface-400">
          Default reorder quantity
          <input
            type="number"
            min="1"
            step="1"
            value={ops.defaultReorderQuantity}
            onChange={(event) => setOps((current) => ({ ...current, defaultReorderQuantity: Number(event.target.value) }))}
            className="mt-1 block w-full"
          />
        </label>
        <label className="text-xs text-surface-400">
          Average free shipping cost ($)
          <input
            type="number"
            min="0"
            max="999"
            step="0.01"
            value={ops.averageFreeShippingCost}
            onChange={(event) => setOps((current) => ({ ...current, averageFreeShippingCost: Number(event.target.value) }))}
            className="mt-1 block w-full"
          />
          <span className="mt-1 block text-[11px] text-surface-500">
            Subtracted from estimated profit on orders with $0 customer shipping and $100+ merchandise.
          </span>
        </label>
        <label className="text-xs text-surface-400">
          Sync mode
          <select
            value={ops.syncMode}
            onChange={(event) => {
              const syncMode = event.target.value as SyncMode;
              setOps((current) => ({
                ...current,
                syncMode,
                pollingIntervalMinutes: syncMode === 'manual' ? 0 : current.pollingIntervalMinutes > 0 ? current.pollingIntervalMinutes : 10,
              }));
            }}
            className="mt-1 block w-full"
          >
            <option value="polling">Scheduled (server)</option>
            <option value="webhook_ready">Webhooks + scheduled</option>
            <option value="manual">Off (Sync button only)</option>
          </select>
        </label>
        <label className="text-xs text-surface-400">
          Catch-up interval (minutes)
          <input
            type="number"
            min="0"
            max="1440"
            step="1"
            value={ops.pollingIntervalMinutes}
            onChange={(event) => setOps((current) => ({ ...current, pollingIntervalMinutes: Number(event.target.value) }))}
            className="mt-1 block w-full"
          />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" disabled={saving} className="btn btn-primary btn-sm">{saving ? 'Saving…' : 'Save settings'}</button>
        </div>
      </form>

      <ProductMargins defaultMargin={ops.defaultMarginPercent} />

      {message && <p className="text-sm text-emerald-300">{message}</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}
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

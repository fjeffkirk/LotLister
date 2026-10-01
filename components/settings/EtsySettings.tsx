'use client';

import { useEffect, useState } from 'react';
import { CheckCircleIcon, AlertIcon } from '../ui/icons';

interface Option {
  id: string;
  label: string;
}

interface EtsySettingsData {
  configured: boolean;
  missingEnv: string[];
  connected: boolean;
  shopName: string | null;
  callbackUrl: string;
  shippingProfileId: string;
  readinessStateId: string;
  returnPolicyId: string;
  taxonomyId: string;
  shippingProfiles: Option[];
  readinessStates: Option[];
  returnPolicies: Option[];
  taxonomies: Option[];
  loadError?: string;
}

const EMPTY: EtsySettingsData = {
  configured: false,
  missingEnv: [],
  connected: false,
  shopName: null,
  callbackUrl: '',
  shippingProfileId: '',
  readinessStateId: '',
  returnPolicyId: '',
  taxonomyId: '',
  shippingProfiles: [],
  readinessStates: [],
  returnPolicies: [],
  taxonomies: [],
};

export function EtsySettings() {
  const [settings, setSettings] = useState<EtsySettingsData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch('/api/etsy/settings', { cache: 'no-store' });
    const body = await res.json();
    if (body.success) setSettings({ ...EMPTY, ...body.data });
  }

  useEffect(() => {
    refresh().catch(() => setError('Could not load Etsy settings'));
    const params = new URLSearchParams(window.location.search);
    const notice = params.get('etsy');
    if (notice === 'connected') setMessage('Etsy shop connected');
    if (notice === 'error') setError(params.get('message') || 'Etsy connection failed');
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/etsy/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shippingProfileId: settings.shippingProfileId,
          readinessStateId: settings.readinessStateId,
          returnPolicyId: settings.returnPolicyId,
          taxonomyId: settings.taxonomyId,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not save Etsy settings');
      setMessage('Etsy settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save Etsy settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="etsy" className="panel p-5 sm:p-6 scroll-mt-24 space-y-5">
      <div>
        <h2 className="font-semibold text-white">Etsy shop</h2>
        <p className="mt-1 text-sm text-surface-400">
          List the same ready cards at a fixed price. Auctions stay on eBay. Each listing uses the card price, photos, and the shop profiles you pick here.
        </p>
      </div>

      <div className="flex items-start gap-3">
        <span className={`mt-0.5 ${settings.connected ? 'text-emerald-300' : 'text-amber-300'}`}>
          {settings.connected ? <CheckCircleIcon size={18} /> : <AlertIcon size={18} />}
        </span>
        <span className="text-sm text-surface-200">
          {settings.connected ? `Connected to ${settings.shopName || 'your Etsy shop'}` : 'Etsy is not connected yet'}
        </span>
      </div>

      {!settings.configured && (
        <p className="text-sm text-amber-100">
          Add {settings.missingEnv.join(' and ') || 'ETSY_KEYSTRING and ETSY_SHARED_SECRET'} on Render. In the Etsy app, set the callback URL to{' '}
          <code className="font-mono text-surface-100">{settings.callbackUrl || 'https://lotlister.onrender.com/api/etsy/callback'}</code>.
        </p>
      )}

      {settings.configured && (
        <a href="/api/etsy/connect" className="btn btn-primary btn-sm inline-flex">
          {settings.connected ? 'Reconnect Etsy' : 'Connect Etsy'}
        </a>
      )}

      {settings.loadError && <p className="text-sm text-red-300">{settings.loadError}</p>}

      {settings.connected && (
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Shipping profile"
            value={settings.shippingProfileId}
            options={settings.shippingProfiles}
            onChange={(shippingProfileId) => setSettings((current) => ({ ...current, shippingProfileId }))}
          />
          <Select
            label="Processing profile"
            value={settings.readinessStateId}
            options={settings.readinessStates}
            onChange={(readinessStateId) => setSettings((current) => ({ ...current, readinessStateId }))}
          />
          <Select
            label="Return policy"
            value={settings.returnPolicyId}
            options={settings.returnPolicies}
            onChange={(returnPolicyId) => setSettings((current) => ({ ...current, returnPolicyId }))}
          />
          <Select
            label="Category"
            value={settings.taxonomyId}
            options={settings.taxonomies}
            onChange={(taxonomyId) => setSettings((current) => ({ ...current, taxonomyId }))}
          />
          <p className="sm:col-span-2 text-xs text-surface-500">
            Listings renew on Etsy’s usual schedule. Create these profiles in the Etsy shop if the lists are empty.
          </p>
          <div>
            <button type="submit" disabled={saving} className="btn btn-primary btn-sm">{saving ? 'Saving…' : 'Save Etsy settings'}</button>
          </div>
        </form>
      )}

      {message && <p className="text-sm text-emerald-300">{message}</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}
    </section>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs text-surface-400">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 block w-full">
        <option value="">Choose one</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

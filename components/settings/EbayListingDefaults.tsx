'use client';

import { useEffect, useState } from 'react';

const SHIPPING_SERVICES: { id: string; label: string }[] = [
  { id: 'USPSParcel', label: 'USPS Ground Advantage' },
  { id: 'USPSFirstClass', label: 'USPS First Class' },
  { id: 'USPSPriority', label: 'USPS Priority Mail' },
  { id: 'USPSPriorityExpress', label: 'USPS Priority Mail Express' },
  { id: 'UPSGround', label: 'UPS Ground' },
  { id: 'UPS3rdDay', label: 'UPS 3 Day Select' },
  { id: 'UPS2ndDay', label: 'UPS 2nd Day Air' },
  { id: 'UPSNextDay', label: 'UPS Next Day Air' },
  { id: 'FedExHomeDelivery', label: 'FedEx Ground' },
  { id: 'FedEx2Day', label: 'FedEx 2Day' },
];

interface Defaults {
  postalCode: string;
  location: string;
  shippingService: string;
  shippingCost: number;
  freeShipping: boolean;
  additionalItemCost: number;
  handlingDays: number;
  returnsAccepted: boolean;
  returnDays: number;
  returnShippingPaidBy: string;
  bestOfferEnabled: boolean;
}

const EMPTY: Defaults = {
  postalCode: '',
  location: '',
  shippingService: 'USPSParcel',
  shippingCost: 0,
  freeShipping: false,
  additionalItemCost: 0,
  handlingDays: 1,
  returnsAccepted: true,
  returnDays: 30,
  returnShippingPaidBy: 'Buyer',
  bestOfferEnabled: false,
};

export function EbayListingDefaults() {
  const [values, setValues] = useState<Defaults>(EMPTY);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/ebay/listing-defaults', { cache: 'no-store' })
      .then((res) => res.json())
      .then((body) => {
        if (body.success && body.data) {
          setValues({ ...EMPTY, ...body.data });
          setSaved(true);
        }
      })
      .catch(() => setError('Could not load eBay listing defaults'));
  }, []);

  function set<K extends keyof Defaults>(key: K, value: Defaults[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/ebay/listing-defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not save eBay listing defaults');
      setSaved(true);
      setMessage('eBay listing defaults saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save eBay listing defaults');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-6 pt-5 border-t border-white/[0.06] space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Shopify products on eBay</h3>
        <p className="mt-1 text-sm text-surface-400">
          {saved
            ? 'Agents use these when they copy a Shopify product to eBay. Card lots keep their own listing settings.'
            : 'Save these before an agent copies a Shopify product to eBay. Card lots keep their own listing settings.'}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs text-surface-400">
          Ships from (city, state)
          <input className="mt-1 block w-full" value={values.location} placeholder="Austin, TX" onChange={(event) => set('location', event.target.value)} required />
        </label>
        <label className="text-xs text-surface-400">
          ZIP code
          <input className="mt-1 block w-full" value={values.postalCode} inputMode="numeric" placeholder="78701" onChange={(event) => set('postalCode', event.target.value)} required />
        </label>
        <label className="text-xs text-surface-400">
          Shipping service
          <select className="mt-1 block w-full" value={values.shippingService} onChange={(event) => set('shippingService', event.target.value)}>
            {SHIPPING_SERVICES.map((service) => <option key={service.id} value={service.id}>{service.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-surface-400">
          Handling time (business days)
          <input className="mt-1 block w-full" type="number" min={0} max={30} value={values.handlingDays} onChange={(event) => set('handlingDays', Number(event.target.value))} />
        </label>
        <label className="text-xs text-surface-400">
          Shipping charge (USD)
          <input className="mt-1 block w-full" type="number" min={0} step="0.01" disabled={values.freeShipping} value={values.shippingCost} onChange={(event) => set('shippingCost', Number(event.target.value))} />
        </label>
        <label className="text-xs text-surface-400">
          Each additional unit (USD)
          <input className="mt-1 block w-full" type="number" min={0} step="0.01" disabled={values.freeShipping} value={values.additionalItemCost} onChange={(event) => set('additionalItemCost', Number(event.target.value))} />
        </label>
        <label className="text-xs text-surface-400">
          Returns
          <select
            className="mt-1 block w-full"
            value={values.returnsAccepted ? String(values.returnDays) : 'none'}
            onChange={(event) => {
              if (event.target.value === 'none') set('returnsAccepted', false);
              else setValues((current) => ({ ...current, returnsAccepted: true, returnDays: Number(event.target.value) }));
            }}
          >
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="none">No returns</option>
          </select>
        </label>
        <label className="text-xs text-surface-400">
          Return shipping paid by
          <select className="mt-1 block w-full" disabled={!values.returnsAccepted} value={values.returnShippingPaidBy} onChange={(event) => set('returnShippingPaidBy', event.target.value)}>
            <option value="Buyer">Buyer</option>
            <option value="Seller">Seller</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="inline-flex items-center gap-2 text-sm text-surface-200">
          <input type="checkbox" checked={values.freeShipping} onChange={(event) => set('freeShipping', event.target.checked)} />
          Free shipping
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-surface-200">
          <input type="checkbox" checked={values.bestOfferEnabled} onChange={(event) => set('bestOfferEnabled', event.target.checked)} />
          Accept best offers
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className="btn btn-primary btn-sm">{saving ? 'Saving…' : 'Save eBay defaults'}</button>
        {message && <span className="text-sm text-emerald-300">{message}</span>}
        {error && <span className="text-sm text-red-300">{error}</span>}
      </div>
    </form>
  );
}

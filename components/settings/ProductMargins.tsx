'use client';

import { useEffect, useState } from 'react';
import { CheckIcon, RotateIcon } from '../ui/icons';

type Product = {
  id: string;
  title: string;
  sku: string | null;
  imageUrl: string | null;
  vendor: string | null;
  marginPercentOverride: number | null;
};

export function ProductMargins({ defaultMargin }: { defaultMargin: number }) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/catalog/items', { cache: 'no-store' })
      .then((res) => res.json())
      .then((body) => {
        if (!body.ok) throw new Error(body.error || 'Could not load products');
        setProducts(body.products ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load products'));
  }, []);

  const query = search.trim().toLowerCase();
  const shown = (products ?? []).filter((product) => {
    if (!query) return true;
    return product.title.toLowerCase().includes(query) || (product.sku ?? '').toLowerCase().includes(query);
  });

  return (
    <div className="space-y-3 border-t border-white/[0.06] pt-5">
      <div>
        <h3 className="text-sm font-medium text-white">Product margins</h3>
        <p className="mt-1 text-xs text-surface-500">
          Leave a product blank to use the {defaultMargin}% default. A number here replaces that default for that product only. Profit uses these margins. Shopify’s cost is not used.
        </p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search product or SKU"
          className="max-w-xs"
          aria-label="Search products"
        />
        <p className="text-xs text-surface-500">{products ? `${shown.length} products` : ''}</p>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      {products === null && !error && <div className="skeleton h-24 w-full" />}
      {products && shown.length === 0 && (
        <p className="text-sm text-surface-400">No products yet. Run a Shopify sync, then set margins here.</p>
      )}
      {shown.length > 0 && (
        <div className="max-h-[32rem] overflow-y-auto rounded-xl border border-white/[0.06] divide-y divide-white/[0.06]">
          {shown.map((product) => (
            <MarginRow key={product.id} product={product} defaultMargin={defaultMargin} />
          ))}
        </div>
      )}
    </div>
  );
}

function MarginRow({ product, defaultMargin }: { product: Product; defaultMargin: number }) {
  const [override, setOverride] = useState(product.marginPercentOverride);
  const [value, setValue] = useState(override != null ? String(override) : '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = value !== (override != null ? String(override) : '');

  async function persist(next: number | null) {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/catalog/item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: product.id, marginPercent: next }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error || 'Could not save margin');
      setOverride(next);
      setValue(next != null ? String(next) : '');
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save margin');
    } finally {
      setSaving(false);
    }
  }

  function save() {
    if (value.trim() === '') {
      void persist(null);
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      setError('Enter a margin from 0 to 100, or leave it blank');
      return;
    }
    void persist(parsed);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 sm:flex-nowrap">
      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-white/[0.04]">
        {product.imageUrl ? <img src={product.imageUrl} alt="" className="h-full w-full object-cover" /> : null}
      </div>
      <div className="min-w-0 flex-1 basis-[calc(100%-3rem)] sm:basis-auto">
        <p className="truncate text-sm text-surface-100">{product.title}</p>
        <p className="truncate text-[11px] text-surface-500">
          {product.sku || 'No SKU'}
          {product.vendor ? ` · ${product.vendor}` : ''}
          {error ? ` · ${error}` : ''}
        </p>
      </div>
      <span className={`shrink-0 text-[11px] ${override != null ? 'text-primary-300' : 'text-surface-500'}`}>
        {override != null ? 'Override' : `Default ${defaultMargin}%`}
      </span>
      <input
        type="number"
        min="0"
        max="100"
        step="0.1"
        value={value}
        placeholder={String(defaultMargin)}
        onChange={(event) => {
          setValue(event.target.value);
          setSaved(false);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save();
        }}
        className="w-20 text-right"
        aria-label={`Margin for ${product.title}`}
      />
      {override != null && (
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          title="Use the default margin"
          onClick={() => void persist(null)}
          disabled={saving}
        >
          <RotateIcon size={14} />
        </button>
      )}
      <button type="button" className="btn btn-secondary btn-sm w-16" onClick={save} disabled={saving || (!dirty && !saved)}>
        {saving ? <RotateIcon size={14} className="animate-spin [animation-direction:reverse]" /> : saved ? <CheckIcon size={14} /> : 'Save'}
      </button>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { isReadyForSoldComps } from '../../lib/card-completeness';
import type { CardImage, CardItemWithImages } from '../../lib/types';
import { imagePathToBrowserSrc } from '../../lib/imageUrls';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, CopyIcon, ExternalIcon, ImageIcon, PhotosIcon } from '../ui/icons';
import ZoomPhoto from './ZoomPhoto';

export function sortCardImages(images: CardImage[]): CardImage[] {
  return [...images].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Side panel showing the photos of whichever row has focus; a slim rail until a row is picked. */
export default function PhotoPanel({ card, onClose }: { card: CardItemWithImages | null; onClose: () => void }) {
  const images = useMemo(() => sortCardImages(card?.images ?? []), [card?.images]);
  const [index, setIndex] = useState(0);
  const [photoZoomed, setPhotoZoomed] = useState(false);

  useEffect(() => setIndex(0), [card?.id]);

  const current = images[Math.min(index, images.length - 1)];
  const [copied, setCopied] = useState(false);
  const label = card ? card.title || card.name || (card.cardNumber ? `Card #${card.cardNumber}` : 'Untitled card') : '';
  const title = card?.title?.trim() ?? '';

  if (!card) {
    return (
      <aside className="w-12 flex-shrink-0 border-l border-white/[0.06] bg-white/[0.01] flex flex-col items-center gap-3 py-3">
        <button onClick={onClose} className="p-1.5 rounded-md text-surface-500 hover:text-surface-100 hover:bg-white/[0.06]" aria-label="Hide photos" title="Hide photos">
          <CloseIcon size={14} />
        </button>
        <PhotosIcon size={18} className="text-surface-500" />
        <span className="text-[11px] text-surface-500 [writing-mode:vertical-rl] rotate-180 tracking-wide">
          Click a row to preview photos
        </span>
      </aside>
    );
  }

  return (
    <aside
      className="ag-custom-component-popup w-[26rem] flex-shrink-0 border-l border-white/[0.06] bg-surface-900 flex flex-col min-h-0 animate-fade-in"
      onMouseDown={(event) => {
        if (event.button === 0) event.preventDefault();
      }}
    >
      <div className="flex items-center justify-between gap-2 px-3 h-11 border-b border-white/[0.06]">
        <span className="text-sm font-medium text-surface-100 truncate" title={label}>
          {label}
        </span>
        <button
          type="button"
          disabled={!title}
          onClick={() => {
            if (!title) return;
            navigator.clipboard?.writeText(title).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="p-1.5 rounded-md text-surface-400 hover:text-surface-100 hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none"
          aria-label="Copy title"
          title={copied ? 'Copied' : 'Copy title'}
        >
          {copied ? <CheckIcon size={14} className="text-emerald-300" /> : <CopyIcon size={14} />}
        </button>
        <button onClick={onClose} className="p-1.5 rounded-md text-surface-400 hover:text-surface-100 hover:bg-white/[0.06]" aria-label="Hide photos">
          <CloseIcon size={14} />
        </button>
      </div>

      <RecentSales card={card} />

      {images.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-surface-500">
          <ImageIcon size={26} />
          <p className="text-sm">This card has no photos</p>
        </div>
      ) : (
        <>
          <div className="relative flex-1 min-h-0 bg-[radial-gradient(circle_at_50%_40%,#1d212b,#0a0c10)] p-3 group">
            <ZoomPhoto
              key={card.id}
              src={imagePathToBrowserSrc(current.originalPath)}
              alt={`${label} photo ${index + 1}`}
              onZoomChange={setPhotoZoomed}
            />
            {images.length > 1 && !photoZoomed && (
              <>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 backdrop-blur text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Previous photo"
                >
                  <ChevronLeftIcon />
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setIndex((i) => (i + 1) % images.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 backdrop-blur text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Next photo"
                >
                  <ChevronRightIcon />
                </button>
                <span className="absolute top-3 left-3 chip bg-black/60 border-white/10 text-white backdrop-blur">
                  {index === 0 ? 'Front' : index === 1 ? 'Back' : `Photo ${index + 1}`}
                </span>
              </>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-2 p-2.5 border-t border-white/[0.06] overflow-x-auto">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setIndex(i)}
                  className={`w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden ring-2 transition-all ${
                    i === index ? 'ring-primary-400' : 'ring-transparent opacity-60 hover:opacity-100'
                  }`}
                >
                  <img src={imagePathToBrowserSrc(img.thumbPath || img.originalPath)} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

interface SoldSale {
  title: string;
  price: number;
  soldAt: string | null;
  url: string | null;
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function soldDate(iso: string | null): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function compKey(card: CardItemWithImages): string {
  return [
    card.id,
    card.year,
    card.brand,
    card.setName,
    card.name,
    card.cardNumber,
    card.subsetParallel,
    card.grader,
    card.grade,
    card.conditionType,
    card.category,
    card.description,
    card.title,
    card.images.length,
  ].join('|');
}

function RecentSales({ card }: { card: CardItemWithImages }) {
  const ready = isReadyForSoldComps(card);
  const key = compKey(card);
  const [sales, setSales] = useState<SoldSale[]>([]);
  const [searchUrl, setSearchUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ready) {
      setSales([]);
      setSearchUrl(null);
      setMessage(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetch('/api/ebay/comps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card }),
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((body) => {
          if (!body.success) throw new Error(body.error || 'Could not load recent sales');
          setSales(body.data?.sales ?? []);
          setSearchUrl(body.data?.searchUrl ?? null);
          setMessage(body.data?.message ?? null);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setSales([]);
          setMessage(error instanceof Error ? error.message : 'Could not load recent sales');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [ready, key, card]);

  return (
    <div className="border-b border-white/[0.06] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-surface-500">Recent sales</span>
        {searchUrl && (
          <a href={searchUrl} target="_blank" rel="noreferrer" className="text-[11px] text-surface-400 hover:text-white inline-flex items-center gap-1">
            eBay <ExternalIcon size={11} />
          </a>
        )}
      </div>
      {!ready ? (
        <p className="mt-1.5 text-xs text-surface-500">Fill every field except price to see the last 3 eBay sales.</p>
      ) : loading ? (
        <div className="mt-2 space-y-1.5">
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-5/6" />
          <div className="skeleton h-4 w-4/6" />
        </div>
      ) : message && sales.length === 0 ? (
        <p className="mt-1.5 text-xs text-surface-400">{message}</p>
      ) : sales.length === 0 ? (
        <p className="mt-1.5 text-xs text-surface-500">No recent eBay sales matched this card.</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {sales.map((sale) => {
            const row = (
              <>
                <span className="text-sm font-medium text-white tabular-nums flex-shrink-0">{money.format(sale.price)}</span>
                <span className="min-w-0 text-xs text-surface-400 truncate">
                  {soldDate(sale.soldAt)}
                  {sale.soldAt ? ' · ' : ''}
                  {sale.title}
                </span>
              </>
            );
            const className = 'flex items-baseline gap-2 min-w-0';
            return (
              <li key={`${sale.title}-${sale.soldAt}-${sale.price}`}>
                {sale.url ? (
                  <a href={sale.url} target="_blank" rel="noreferrer" className={`${className} hover:text-white`}>{row}</a>
                ) : (
                  <div className={className}>{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

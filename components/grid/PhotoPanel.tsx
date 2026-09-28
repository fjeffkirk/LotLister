'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CardImage, CardItemWithImages } from '../../lib/types';
import { imagePathToBrowserSrc } from '../../lib/imageUrls';

export function sortCardImages(images: CardImage[]): CardImage[] {
  return [...images].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Side panel showing the photos of whichever row has focus, so you can read the card while typing. */
export default function PhotoPanel({ card, onClose }: { card: CardItemWithImages | null; onClose: () => void }) {
  const images = useMemo(() => sortCardImages(card?.images ?? []), [card?.images]);
  const [index, setIndex] = useState(0);

  useEffect(() => setIndex(0), [card?.id]);

  const current = images[Math.min(index, images.length - 1)];
  const label = card ? card.title || card.name || (card.cardNumber ? `Card #${card.cardNumber}` : 'Untitled card') : '';

  return (
    <aside className="w-80 flex-shrink-0 border-l border-surface-700 bg-surface-900 flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-surface-700">
        <span className="text-sm font-medium text-surface-200 truncate" title={label}>
          {label || 'Photos'}
        </span>
        <button onClick={onClose} className="p-1 rounded text-surface-400 hover:text-surface-100 hover:bg-surface-800" aria-label="Hide photos">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {!card ? (
        <p className="p-4 text-sm text-surface-500">Click a cell to see that card&apos;s photos here.</p>
      ) : images.length === 0 ? (
        <p className="p-4 text-sm text-surface-500">This card has no photos.</p>
      ) : (
        <>
          <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center">
            <img
              key={current.id}
              src={imagePathToBrowserSrc(current.originalPath)}
              alt={`${label} photo ${index + 1}`}
              className="max-w-full max-h-full object-contain"
            />
            {images.length > 1 && (
              <>
                <button
                  onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/60 rounded-full text-white hover:bg-black/80"
                  aria-label="Previous photo"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => setIndex((i) => (i + 1) % images.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/60 rounded-full text-white hover:bg-black/80"
                  aria-label="Next photo"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-2 p-2 border-t border-surface-700 overflow-x-auto">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  onClick={() => setIndex(i)}
                  className={`w-12 h-12 flex-shrink-0 rounded overflow-hidden border-2 ${
                    i === index ? 'border-primary-500' : 'border-surface-700 hover:border-surface-500'
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

'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CardImage, CardItemWithImages } from '../../lib/types';
import { imagePathToBrowserSrc } from '../../lib/imageUrls';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, ImageIcon, PhotosIcon } from '../ui/icons';

export function sortCardImages(images: CardImage[]): CardImage[] {
  return [...images].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Side panel showing the photos of whichever row has focus; a slim rail until a row is picked. */
export default function PhotoPanel({ card, onClose }: { card: CardItemWithImages | null; onClose: () => void }) {
  const images = useMemo(() => sortCardImages(card?.images ?? []), [card?.images]);
  const [index, setIndex] = useState(0);

  useEffect(() => setIndex(0), [card?.id]);

  const current = images[Math.min(index, images.length - 1)];
  const label = card ? card.title || card.name || (card.cardNumber ? `Card #${card.cardNumber}` : 'Untitled card') : '';

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
    <aside className="w-80 flex-shrink-0 border-l border-white/[0.06] bg-surface-900 flex flex-col min-h-0 animate-fade-in">
      <div className="flex items-center justify-between gap-2 px-3 h-11 border-b border-white/[0.06]">
        <span className="text-sm font-medium text-surface-100 truncate" title={label}>
          {label}
        </span>
        <button onClick={onClose} className="p-1.5 rounded-md text-surface-400 hover:text-surface-100 hover:bg-white/[0.06]" aria-label="Hide photos">
          <CloseIcon size={14} />
        </button>
      </div>

      {images.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-surface-500">
          <ImageIcon size={26} />
          <p className="text-sm">This card has no photos</p>
        </div>
      ) : (
        <>
          <div className="relative flex-1 min-h-0 bg-[radial-gradient(circle_at_50%_40%,#1d212b,#0a0c10)] flex items-center justify-center p-3 group">
            <img
              key={current.id}
              src={imagePathToBrowserSrc(current.originalPath)}
              alt={`${label} photo ${index + 1}`}
              className="max-w-full max-h-full object-contain rounded-md shadow-pop animate-fade-in"
            />
            {images.length > 1 && (
              <>
                <button
                  onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 backdrop-blur text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Previous photo"
                >
                  <ChevronLeftIcon />
                </button>
                <button
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

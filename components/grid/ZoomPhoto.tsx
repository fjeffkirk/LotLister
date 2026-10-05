'use client';

import { useEffect, useRef, useState } from 'react';

/** Same idea as an eBay listing photo: one fixed magnification, panned from the pointer. */
const ZOOM = 2.5;
const PAN_SLOP_PX = 6;

export function imageLayoutBox(img: HTMLImageElement): { left: number; top: number; width: number; height: number } | null {
  const parent = img.offsetParent as HTMLElement | null;
  if (!parent || img.offsetWidth < 1 || img.offsetHeight < 1) return null;
  const parentBox = parent.getBoundingClientRect();
  return {
    left: parentBox.left + parent.clientLeft + img.offsetLeft,
    top: parentBox.top + parent.clientTop + img.offsetTop,
    width: img.offsetWidth,
    height: img.offsetHeight,
  };
}

export function percentWithin(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number }
): { x: number; y: number } {
  const x = ((clientX - box.left) / box.width) * 100;
  const y = ((clientY - box.top) / box.height) * 100;
  return { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) };
}

/** Click the photo to magnify it in place. Move the pointer to look around the card. */
export default function ZoomPhoto({
  src,
  alt,
  hint = 'bottom',
  onZoomChange,
}: {
  src: string;
  alt: string;
  hint?: 'top' | 'bottom';
  onZoomChange?: (zoomed: boolean) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [zoomed, setZoomed] = useState(false);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const zoomedRef = useRef(false);
  const movedRef = useRef(false);
  const downRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    zoomedRef.current = zoomed;
    onZoomChange?.(zoomed);
  }, [zoomed, onZoomChange]);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (event.target instanceof Element && event.target.closest('.ag-cell, .ag-popup, .ag-popup-editor')) return;
      setZoomed(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed]);

  function track(clientX: number, clientY: number) {
    const img = imgRef.current;
    if (!img) return;
    const box = imageLayoutBox(img);
    if (!box) return;
    setOrigin(percentWithin(clientX, clientY, box));
  }

  const hintClass = hint === 'top' ? 'top-2' : 'bottom-2';
  const zoomStyle = zoomed
    ? {
        backgroundImage: `url(${JSON.stringify(src)})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${ZOOM * 100}% ${ZOOM * 100}%`,
        backgroundPosition: `${origin.x}% ${origin.y}%`,
      }
    : undefined;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={zoomed}
      aria-label={zoomed ? 'Zoom out of photo' : 'Zoom in on photo'}
      className={`relative flex h-full w-full items-center justify-center overflow-hidden ${zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'}`}
      style={{ touchAction: zoomed ? 'none' : 'pan-y' }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        movedRef.current = false;
        downRef.current = { x: event.clientX, y: event.clientY };
        if (zoomedRef.current) event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const down = downRef.current;
        if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > PAN_SLOP_PX) movedRef.current = true;
        if (!zoomedRef.current) return;
        track(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        if (event.button !== 0) return;
        const panned = movedRef.current && zoomedRef.current;
        downRef.current = null;
        movedRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (panned) return;
        track(event.clientX, event.clientY);
        setZoomed((value) => !value);
      }}
      onPointerCancel={() => {
        downRef.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setZoomed((value) => !value);
        }
      }}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        className={`max-h-full max-w-full object-contain select-none rounded-md shadow-pop animate-fade-in ${zoomed ? 'invisible' : ''}`}
      />
      {zoomed && imgRef.current && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: imgRef.current.offsetLeft,
            top: imgRef.current.offsetTop,
            width: imgRef.current.offsetWidth,
            height: imgRef.current.offsetHeight,
            ...zoomStyle,
          }}
        />
      )}
      {!zoomed && (
        <span className={`pointer-events-none absolute ${hintClass} left-1/2 z-10 -translate-x-1/2 chip border-white/10 bg-black/60 text-white backdrop-blur ${hint === 'bottom' ? 'opacity-0 transition-opacity group-hover:opacity-100' : ''}`}>
          Click to zoom
        </span>
      )}
    </div>
  );
}

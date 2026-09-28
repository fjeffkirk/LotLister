'use client';

import { CSSProperties, useMemo } from 'react';

const COLORS = ['#6b95ff', '#9a66ff', '#34d399', '#fbbf24', '#f472b6', '#ffffff'];
const PIECES = 90;

/** One-shot confetti burst; unmount it to clear. Hidden when the user prefers reduced motion. */
export function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => ({
        left: `${Math.random() * 100}%`,
        background: COLORS[i % COLORS.length],
        '--drift': `${(Math.random() - 0.5) * 240}px`,
        '--spin': `${(Math.random() - 0.5) * 1440}deg`,
        '--duration': `${2.2 + Math.random() * 1.6}s`,
        '--delay': `${Math.random() * 0.5}s`,
        width: `${6 + Math.random() * 6}px`,
        height: `${10 + Math.random() * 8}px`,
      })),
    []
  );
  return (
    <div className="fixed inset-0 z-[80] pointer-events-none overflow-hidden" aria-hidden="true">
      {pieces.map((style, i) => (
        <span key={i} className="confetti-piece" style={style as CSSProperties} />
      ))}
    </div>
  );
}

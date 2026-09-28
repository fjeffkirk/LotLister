'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';

interface DropdownProps {
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  menuClassName?: string;
}

/** Trigger + floating menu that closes on outside click, Escape, or when an item calls close(). */
export function Dropdown({ trigger, children, align = 'right', menuClassName = '' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((value) => !value), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {trigger({ open, toggle })}
      {open && (
        <div role="menu" className={`menu ${align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'} ${menuClassName}`}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

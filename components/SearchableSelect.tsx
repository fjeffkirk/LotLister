'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CATEGORY_GROUPS } from '../lib/types';

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Inline styles applied to the trigger button */
  triggerStyle?: React.CSSProperties;
  triggerClassName?: string;
}

/**
 * Grouped, searchable category picker.
 * The dropdown is rendered with position:fixed so it works inside AG Grid cells
 * (which have overflow:hidden) without being clipped.
 */
export default function SearchableSelect({
  value,
  onChange,
  placeholder = 'Select a Category...',
  triggerStyle,
  triggerClassName,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

  const openDropdown = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownHeight = 320;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= dropdownHeight
      ? rect.bottom + 2
      : rect.top - dropdownHeight - 2;
    setDropdownPos({ top, left: rect.left, width: Math.max(rect.width, 240) });
    setSearch('');
    setOpen(true);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus search input when opened
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 30);
  }, [open]);

  const lowerSearch = search.toLowerCase();

  const filteredGroups = CATEGORY_GROUPS.map((g) => ({
    ...g,
    filtered: g.options.filter((o) => o.toLowerCase().includes(lowerSearch)),
  })).filter((g) => g.filtered.length > 0);

  const handleSelect = (option: string) => {
    onChange(option);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); openDropdown(); }}
        style={triggerStyle}
        className={triggerClassName}
      >
        <span style={{ color: value ? undefined : '#a1a1aa' }}>
          {value || placeholder}
        </span>
        <svg
          style={{ marginLeft: 'auto', flexShrink: 0, opacity: 0.5 }}
          width="12" height="12" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 99999,
            background: '#1c1c1f',
            border: '1px solid #3f3f46',
            borderRadius: '8px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '320px',
            overflow: 'hidden',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Search input */}
          <div style={{ padding: '8px', borderBottom: '1px solid #3f3f46', flexShrink: 0 }}>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search categories..."
              style={{
                width: '100%',
                background: '#27272a',
                border: '1px solid #52525b',
                borderRadius: '6px',
                color: '#fafafa',
                fontSize: '13px',
                padding: '5px 8px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
              }}
            />
          </div>

          {/* Options list */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filteredGroups.length === 0 ? (
              <div style={{ padding: '10px 12px', color: '#71717a', fontSize: '13px' }}>
                No categories match
              </div>
            ) : (
              filteredGroups.map((g) => (
                <div key={g.group}>
                  {/* Group header */}
                  <div style={{
                    padding: '6px 12px 3px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#a1a1aa',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    position: 'sticky',
                    top: 0,
                    background: '#1c1c1f',
                  }}>
                    {g.group}
                  </div>
                  {g.filtered.map((opt) => (
                    <div
                      key={opt}
                      onClick={() => handleSelect(opt)}
                      style={{
                        padding: '7px 16px',
                        fontSize: '13px',
                        color: opt === value ? '#a78bfa' : '#fafafa',
                        background: opt === value ? 'rgba(139,92,246,0.15)' : 'transparent',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      onMouseEnter={(e) => {
                        if (opt !== value) (e.currentTarget as HTMLDivElement).style.background = '#27272a';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background =
                          opt === value ? 'rgba(139,92,246,0.15)' : 'transparent';
                      }}
                    >
                      {opt}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

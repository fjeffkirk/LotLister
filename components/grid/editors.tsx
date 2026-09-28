'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CustomCellEditorProps } from 'ag-grid-react';
import type { CardItemWithImages } from '../../lib/types';
import { FieldOption, filterOptions } from '../../lib/card-fields';

const CLEAR_OPTION: FieldOption = { value: '', label: 'Clear', hint: 'Remove the value' };
const MAX_SUGGESTIONS = 8;
const LIST_HEIGHT = 290;

/** The key that started editing, if it was a printable character (so typing "p" opens with "p"). */
function typedStart(eventKey: string | null): string | null {
  return eventKey && eventKey.length === 1 ? eventKey : null;
}

export interface TypedAhead {
  text: string;
  /** Enter was pressed too; commit as soon as the editor has applied the text. */
  enter: boolean;
}

/** Keys typed after editing started but before this editor's input took focus. Call right before focusing. */
function takeTypedAhead(context: { takeTypedAhead?: () => TypedAhead } | undefined): TypedAhead {
  return context?.takeTypedAhead?.() ?? { text: '', enter: false };
}

/** Opens the list upward when the cell is near the bottom of the grid, where it would be clipped. */
function useDropUp(anchor: React.RefObject<HTMLElement>): boolean {
  const [dropUp, setDropUp] = useState(false);
  useLayoutEffect(() => {
    const el = anchor.current;
    if (!el) return;
    const bounds = (el.closest('.ag-root-wrapper') as HTMLElement | null)?.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const bottom = bounds ? bounds.bottom : window.innerHeight;
    setDropUp(bottom - rect.bottom < LIST_HEIGHT && rect.top - (bounds?.top ?? 0) > bottom - rect.bottom);
  }, [anchor]);
  return dropUp;
}

function useScrollActiveIntoView(list: React.RefObject<HTMLElement>, active: number) {
  useEffect(() => {
    const item = list.current?.children[active] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [list, active]);
}

type EditorProps = CustomCellEditorProps<CardItemWithImages, string>;

interface TypeaheadParams {
  options: FieldOption[];
  allowClear?: boolean;
}

/**
 * Dropdown editor you can type into: "ps" + Enter picks PSA, arrows move, Tab/Enter commit, Esc cancels.
 * The grid handles Enter/Tab/Esc itself, so the highlighted option is always reported as the editor value.
 */
export function TypeaheadEditor(props: EditorProps & TypeaheadParams) {
  const { options, allowClear, eventKey, initialValue, onValueChange, stopEditing, column, context } = props;
  const start = typedStart(eventKey);
  const [query, setQuery] = useState(start ?? '');
  const matches = useMemo(() => {
    const list = filterOptions(options, query);
    return allowClear && !query && initialValue ? [...list, CLEAR_OPTION] : list;
  }, [options, query, allowClear, initialValue]);
  const [active, setActive] = useState(() => {
    if (start) return 0;
    const index = options.findIndex((option) => option.value === initialValue);
    return index < 0 ? 0 : index;
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dropUp = useDropUp(wrapRef);
  useScrollActiveIntoView(listRef, active);

  const choose = (list: FieldOption[], index: number) => {
    setActive(index);
    onValueChange(list[index] ? list[index].value : initialValue);
  };

  useEffect(() => {
    const ahead = takeTypedAhead(context);
    const typed = (start ?? '') + ahead.text;
    inputRef.current?.focus();
    if (typed) {
      setQuery(typed);
      choose(filterOptions(options, typed), 0);
    }
    if (ahead.enter) stopEditing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (matches.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      choose(matches, (active + step + matches.length) % matches.length);
    }
  };

  return (
    <div ref={wrapRef} className="relative" style={{ width: Math.max(column.getActualWidth(), 200) }}>
      <input
        ref={inputRef}
        value={query}
        placeholder="Type to filter…"
        onChange={(e) => {
          setQuery(e.target.value);
          choose(filterOptions(options, e.target.value), 0);
        }}
        onKeyDown={onKeyDown}
        className="grid-editor-input w-full h-[51px] px-3 bg-surface-800 border-2 border-primary-500 rounded text-sm text-surface-100 outline-none"
      />
      <div ref={listRef} className={`grid-editor-list ${dropUp ? 'bottom-full mb-0.5' : 'top-full'}`} role="listbox">
        {matches.length === 0 && <div className="px-2.5 py-1.5 text-surface-500">No match. Esc to cancel</div>}
        {matches.map((option, index) => (
          <div
            key={option.value || 'clear'}
            role="option"
            aria-selected={index === active}
            className={`grid-editor-option ${index === active ? 'active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => choose(matches, index)}
            onClick={() => {
              onValueChange(option.value);
              stopEditing();
            }}
          >
            <span className={option === CLEAR_OPTION ? 'italic text-surface-400' : ''}>{option.label}</span>
            {option.hint && <span className="text-xs text-surface-500 truncate">{option.hint}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function rankSuggestions(values: string[], text: string): string[] {
  const q = text.trim().toLowerCase();
  if (!q) return values.slice(0, MAX_SUGGESTIONS);
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const value of values) {
    const lower = value.toLowerCase();
    if (lower === q) continue;
    if (lower.startsWith(q)) prefix.push(value);
    else if (lower.includes(q)) contains.push(value);
    if (prefix.length >= MAX_SUGGESTIONS) break;
  }
  return [...prefix, ...contains].slice(0, MAX_SUGGESTIONS);
}

/** Free-text editor with suggestions from values used before (Down to pick one, Enter/Tab to commit). */
export function SuggestEditor(props: EditorProps) {
  const { eventKey, initialValue, onValueChange, column, context } = props;
  const field = column.getColId();
  const start = typedStart(eventKey);
  const clearStart = eventKey === 'Backspace' || eventKey === 'Delete';
  const [text, setText] = useState(start ?? (clearStart ? '' : String(initialValue ?? '')));
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dropUp = useDropUp(wrapRef);
  useScrollActiveIntoView(listRef, active);

  const values: string[] = (context?.suggestions?.[field] as string[] | undefined) ?? [];
  const matches = useMemo(() => rankSuggestions(values, text), [values, text]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const ahead = takeTypedAhead(context);
    input.focus();
    if (start || clearStart || ahead.text) {
      const typed = (start ?? '') + ahead.text;
      setText(typed);
      onValueChange(typed);
      requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
    } else {
      input.select();
    }
    if (ahead.enter) props.stopEditing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (index: number) => {
    setActive(index);
    onValueChange(index >= 0 ? matches[index] : text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && matches.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      const next = e.key === 'ArrowDown' ? active + 1 : active - 1;
      pick(next >= matches.length ? -1 : next < -1 ? matches.length - 1 : next);
    }
  };

  return (
    <div ref={wrapRef} className="relative" style={{ width: Math.max(column.getActualWidth(), 180) }}>
      <input
        ref={inputRef}
        value={active >= 0 ? matches[active] : text}
        onChange={(e) => {
          setText(e.target.value);
          setActive(-1);
          onValueChange(e.target.value);
        }}
        onKeyDown={onKeyDown}
        className="grid-editor-input w-full h-[51px] px-3 bg-surface-800 border-2 border-primary-500 rounded text-sm text-surface-100 outline-none"
      />
      {matches.length > 0 && (
        <div ref={listRef} className={`grid-editor-list ${dropUp ? 'bottom-full mb-0.5' : 'top-full'}`} role="listbox">
          {matches.map((value, index) => (
            <div
              key={value}
              role="option"
              aria-selected={index === active}
              className={`grid-editor-option ${index === active ? 'active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onValueChange(value);
                props.stopEditing();
              }}
            >
              <span className="truncate">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

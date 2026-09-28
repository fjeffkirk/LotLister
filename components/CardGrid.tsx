'use client';

import { useRef, useCallback, useMemo, useState, useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type {
  ColDef,
  ICellRendererParams,
  ValueSetterParams,
  ValueFormatterParams,
  EditableCallbackParams,
  CellClickedEvent,
  CellContextMenuEvent,
  CellValueChangedEvent,
  CellKeyDownEvent,
  CellClassParams,
  RowClassParams,
  TabToNextCellParams,
  CellFocusedEvent,
  GridApi,
  IRowNode,
  RowSelectionOptions,
  SelectionColumnDef,
  GetRowIdParams,
  SelectionChangedEvent,
  ModelUpdatedEvent,
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { CardItemWithImages } from '../lib/types';
import {
  COMPLETENESS_FIELDS,
  firstMissingField,
  isCardComplete,
  isCardGraded,
  isMandatoryFieldEmpty,
  missingFieldLabels,
  TITLE_MAX_LENGTH,
} from '../lib/card-completeness';
import { CheckIcon, ImageIcon, PhotosIcon } from './ui/icons';
import {
  CATEGORY_FIELD_OPTIONS,
  CONDITION_FIELD_OPTIONS,
  CONDITION_TYPE_FIELD_OPTIONS,
  conditionShortLabel,
  conditionTypeShortLabel,
  DEFAULT_SUBSET,
  generateAutoTitle,
  GRADE_FIELD_OPTIONS,
  GRADER_FIELD_OPTIONS,
  graderShortLabel,
  isFieldEditable,
  parseFieldValue,
} from '../lib/card-fields';
import { imagePathToBrowserSrc } from '../lib/imageUrls';
import { SuggestEditor, TypeaheadEditor, TypedAhead } from './grid/editors';
import PhotoPanel, { sortCardImages } from './grid/PhotoPanel';
import BulkEditModal, { BulkField } from './grid/BulkEditModal';

type CardUpdate = { id: string; data: Record<string, unknown> };
type TabDirection = 'down' | 'across';

interface CardGridProps {
  cards: CardItemWithImages[];
  onCellChange: (cardId: string, field: string, value: unknown) => void;
  onCardsChange: (updates: CardUpdate[]) => void;
  onCloneCard: (cardId: string) => void;
  onDeleteCard: (cardId: string) => void;
  searchText: string;
  suggestions: Record<string, string[]>;
  notify: (message: string) => void;
}

/** Read by cell renderers and editors; the object itself never changes, so columns never rebuild. */
interface GridContext {
  suggestions: Record<string, string[]>;
  /** Keys typed after editing started but before the editor's input had focus. */
  takeTypedAhead: () => TypedAhead;
  isManualTitle: (cardId: string) => boolean;
  toggleTitleLock: (card: CardItemWithImages, rowIndex: number | null) => void;
}

const HEADERS: Record<string, string> = {
  title: 'Title',
  salePrice: 'Price',
  category: 'Category',
  year: 'Year',
  brand: 'Brand',
  setName: 'Set',
  cardNumber: 'Card #',
  name: 'Name',
  subsetParallel: 'Subset/Parallel',
  conditionType: 'Graded/Raw',
  condition: 'Condition',
  grader: 'Grader',
  grade: 'Grade',
  certNo: 'Cert #',
  description: 'Description',
  team: 'Team',
  variation: 'Variation',
  attributes: 'Attributes',
};

const EXTRA_COLUMNS = ['team', 'variation', 'attributes'];
const SUGGEST_FIELDS = ['brand', 'setName', 'name', 'team', 'subsetParallel', 'variation'] as const;
const GRADED_ONLY = new Set(['grader', 'grade', 'certNo']);
const RAW_ONLY = new Set(['condition']);

// Grid options must keep the same identity across renders, or the grid rebuilds columns and drops the open editor
const ROW_SELECTION: RowSelectionOptions<CardItemWithImages> = {
  mode: 'multiRow',
  checkboxes: true,
  headerCheckbox: true,
  selectAll: 'filtered',
  enableClickSelection: false,
};
const SELECTION_COLUMN: SelectionColumnDef = { pinned: 'left', width: 44, maxWidth: 44, resizable: false, suppressNavigable: true, sortable: false };
const getRowId = (params: GetRowIdParams<CardItemWithImages>) => params.data.id;

const STORAGE_KEYS = {
  photos: 'lotlister.grid.photos',
  moreColumns: 'lotlister.grid.moreColumns',
  tab: 'lotlister.grid.tabDirection',
};

function readSetting<T extends string = string>(key: string, fallback: NoInfer<T>): T {
  try {
    return (window.localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeSetting(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode); the setting just won't persist
  }
}

/** Whether a field applies to this card (grader only on graded cards, condition only on raw). */
function fieldApplies(field: string, card: { conditionType?: string | null }): boolean {
  if (GRADED_ONLY.has(field)) return isCardGraded(card);
  if (RAW_ONLY.has(field)) return !isCardGraded(card);
  return true;
}

/** Titles made before "Base" was dropped from auto titles still count as auto-generated. */
function isAutoTitle(card: CardItemWithImages): boolean {
  const title = card.title ?? '';
  const auto = generateAutoTitle(card);
  if (title === auto) return true;
  const parallel = card.subsetParallel?.trim();
  return Boolean(parallel && parallel.toLowerCase() === DEFAULT_SUBSET.toLowerCase() && title === `${auto} ${parallel}`.trim());
}

function invalidValueMessage(field: string, text: string): string {
  const header = HEADERS[field] ?? field;
  if (field === 'salePrice') return `"${text}" isn't a price. Use a number like 4.99.`;
  if (field === 'year') return `"${text}" isn't a valid year. Use 4 digits, like 2023.`;
  if (field === 'grade') return `"${text}" isn't a grade. Use 1–10 (halves allowed).`;
  return `"${text}" doesn't match any ${header} option.`;
}

// ─── Cell renderers ─────────────────────────────────────────────────────────

function ImageCell(props: ICellRendererParams<CardItemWithImages>) {
  const images = sortCardImages(props.data?.images || []);
  if (images.length === 0) {
    return (
      <div className="flex items-center py-1">
        <div className="w-10 h-10 rounded-lg border border-dashed border-white/[0.12] flex items-center justify-center text-surface-600">
          <ImageIcon size={16} />
        </div>
      </div>
    );
  }
  return (
    <div className="relative flex items-center py-1 cursor-pointer group">
      {images.slice(0, 2).map((img, idx) => (
        <div
          key={img.id}
          className={`w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-surface-800 ring-1 ring-black/40 shadow-md transition-transform duration-200 ${
            idx === 1 ? '-ml-4 rotate-6 group-hover:rotate-12 group-hover:translate-x-1' : '-rotate-2 group-hover:-rotate-6'
          }`}
        >
          <img src={imagePathToBrowserSrc(img.thumbPath || img.originalPath)} alt={`Image ${idx + 1}`} className="w-full h-full object-cover" loading="lazy" />
        </div>
      ))}
      {images.length > 2 && <span className="ml-1.5 text-[11px] text-surface-400">+{images.length - 2}</span>}
    </div>
  );
}

/** Ready / Listed / "N to fill" chip; hovering lists the missing fields. */
function StatusCell(props: ICellRendererParams<CardItemWithImages>) {
  const card = props.data;
  if (!card) return null;
  if (card.ebayItemId) return <span className="chip chip-info">Listed</span>;
  const missing = missingFieldLabels(card);
  if (missing.length === 0) {
    return (
      <span className="chip chip-ready">
        <CheckIcon size={11} strokeWidth={2.5} /> Ready
      </span>
    );
  }
  return <span className="chip chip-warn">{missing.length} to fill</span>;
}

function TitleCell(props: ICellRendererParams<CardItemWithImages>) {
  const card = props.data;
  const context = props.context as GridContext;
  if (!card) return null;
  const manual = context.isManualTitle(card.id);
  const title = card.title || '';
  return (
    <div className="flex items-center gap-2 w-full h-full">
      <span className={`flex-1 truncate ${manual ? 'cursor-text' : ''}`} title={title || undefined}>
        {title ? (
          <span className="text-surface-100">{title}</span>
        ) : (
          <span className="text-surface-500 text-sm italic">
            {manual ? 'Type a title…' : 'Fills in from Year, Set, Card #, Name'}
          </span>
        )}
      </span>
      <button
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          context.toggleTitleLock(card, props.node.rowIndex);
        }}
        className={`p-1 rounded hover:bg-surface-700 transition-colors flex-shrink-0 ${
          manual ? 'text-primary-400' : 'text-surface-500 hover:text-surface-300'
        }`}
        title={manual ? 'Custom title. Click to go back to the automatic title' : 'Automatic title. Click to write your own'}
      >
        {manual ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        )}
      </button>
      <span
        className={`text-xs flex-shrink-0 tabular-nums ${title.length > TITLE_MAX_LENGTH ? 'text-red-300' : 'text-surface-500'}`}
        title="eBay allows 80 characters"
      >
        {title.length}/{TITLE_MAX_LENGTH}
      </span>
    </div>
  );
}

/** Shows the short label plus a chevron that opens the typeahead, for mouse users. */
function SelectCell(props: ICellRendererParams<CardItemWithImages>) {
  const editable = props.node && props.column ? props.column.isCellEditable(props.node) : false;
  const text = props.valueFormatted ?? (props.value as string | null) ?? '';
  return (
    <div className="flex items-center justify-between gap-1 w-full h-full">
      <span className="truncate">{text}</span>
      {editable && (
        <button
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            if (props.node.rowIndex !== null && props.column) {
              props.api.startEditingCell({ rowIndex: props.node.rowIndex, colKey: props.column.getColId() });
            }
          }}
          className="text-surface-500 hover:text-surface-200 px-0.5"
          aria-label="Choose"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ─── Grid ───────────────────────────────────────────────────────────────────

export default function CardGrid({
  cards,
  onCellChange,
  onCardsChange,
  onCloneCard,
  onDeleteCard,
  searchText,
  suggestions,
  notify,
}: CardGridProps) {
  const gridRef = useRef<AgGridReact<CardItemWithImages>>(null);
  const api = (): GridApi<CardItemWithImages> | undefined => gridRef.current?.api;

  // Latest props for callbacks that must stay stable (column defs, grid options)
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const onCellChangeRef = useRef(onCellChange);
  onCellChangeRef.current = onCellChange;
  const onCardsChangeRef = useRef(onCardsChange);
  onCardsChangeRef.current = onCardsChange;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const [showPhotos, setShowPhotos] = useState(() => readSetting(STORAGE_KEYS.photos, 'on') === 'on');
  const [showMoreColumns, setShowMoreColumns] = useState(() => readSetting(STORAGE_KEYS.moreColumns, 'off') === 'on');
  const [tabDirection, setTabDirection] = useState<TabDirection>(() => readSetting<TabDirection>(STORAGE_KEYS.tab, 'down'));
  const tabDirectionRef = useRef(tabDirection);
  tabDirectionRef.current = tabDirection;
  const initialShowMore = useRef(showMoreColumns).current;

  const [focusedCardId, setFocusedCardId] = useState<string | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [displayedCount, setDisplayedCount] = useState(cards.length);
  const [bulkField, setBulkField] = useState<string | null>(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; cardId: string; label: string } | null>(null);

  // "Incomplete only" keeps the rows that were incomplete when it was turned on, so a row
  // doesn't vanish the moment you fill its last field.
  const incompleteIdsRef = useRef<Set<string> | null>(null);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const incompleteCount = useMemo(() => cards.filter((card) => !isCardComplete(card)).length, [cards]);

  // ── Titles: automatic unless the user wrote their own ─────────────────────
  const manualTitlesRef = useRef(new Set<string>());
  const seenCardsRef = useRef(new Set<string>());

  useEffect(() => {
    const updates: CardUpdate[] = [];
    for (const card of cards) {
      if (!seenCardsRef.current.has(card.id)) {
        seenCardsRef.current.add(card.id);
        if (card.title?.trim() && !isAutoTitle(card)) {
          manualTitlesRef.current.add(card.id);
          continue;
        }
      }
      if (manualTitlesRef.current.has(card.id)) continue;
      const auto = generateAutoTitle(card);
      if (auto && card.title !== auto) updates.push({ id: card.id, data: { title: auto } });
    }
    if (updates.length > 0) onCardsChangeRef.current(updates);
  }, [cards]);

  const toggleTitleLock = useCallback((card: CardItemWithImages, rowIndex: number | null) => {
    const manual = manualTitlesRef.current;
    if (manual.has(card.id)) {
      manual.delete(card.id);
      onCellChangeRef.current(card.id, 'title', generateAutoTitle(card));
    } else {
      manual.add(card.id);
    }
    const grid = api();
    grid?.refreshCells({ columns: ['title'], force: true });
    if (manual.has(card.id) && rowIndex !== null) {
      grid?.startEditingCell({ rowIndex, colKey: 'title' });
    }
  }, []);

  const mergedSuggestions = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const field of SUGGEST_FIELDS) {
      const seen = new Set<string>();
      const list: string[] = [];
      const add = (value: unknown) => {
        const text = typeof value === 'string' ? value.trim() : '';
        const key = text.toLowerCase();
        if (text && !seen.has(key)) {
          seen.add(key);
          list.push(text);
        }
      };
      for (let i = cards.length - 1; i >= 0; i--) add((cards[i] as Record<string, unknown>)[field]);
      for (const value of suggestions[field] ?? []) add(value);
      if (field === 'subsetParallel') add(DEFAULT_SUBSET);
      out[field] = list;
    }
    return out;
  }, [cards, suggestions]);

  // React editors mount a frame after editing starts; keys typed in that gap land on the cell
  const typedAheadRef = useRef<TypedAhead>({ text: '', enter: false });

  const gridContext = useRef<GridContext>({
    suggestions: {},
    takeTypedAhead: () => {
      const taken = typedAheadRef.current;
      typedAheadRef.current = { text: '', enter: false };
      return taken;
    },
    isManualTitle: (id) => manualTitlesRef.current.has(id),
    toggleTitleLock,
  }).current;
  gridContext.suggestions = mergedSuggestions;

  // ── Column definitions (built once) ───────────────────────────────────────
  const columns = useMemo<ColDef<CardItemWithImages>[]>(() => {
    const setter = (field: string) => (params: ValueSetterParams<CardItemWithImages>) => {
      const card = params.data;
      if (!card) return false;
      const parsed = parseFieldValue(field, params.newValue);
      if (parsed === undefined) {
        const text = String(params.newValue ?? '').trim();
        if (text) notifyRef.current(invalidValueMessage(field, text));
        return false;
      }
      if (parsed === (card as Record<string, unknown>)[field]) return false;
      onCellChangeRef.current(card.id, field, parsed);
      return true;
    };

    const requiredClass = (field: string) => (params: CellClassParams<CardItemWithImages>) => {
      if (!params.data) return '';
      if (!fieldApplies(field, params.data)) return 'cell-na';
      return isMandatoryFieldEmpty(field, params.value, params.data) ? 'cell-mandatory-empty' : '';
    };

    const appliesEditable = (field: string) => (params: EditableCallbackParams<CardItemWithImages>) =>
      Boolean(params.data && fieldApplies(field, params.data));

    const naFormatter = (field: string, format: (value: string) => string = (v) => v) =>
      (params: ValueFormatterParams<CardItemWithImages>) => {
        if (params.data && !fieldApplies(field, params.data)) return field === 'condition' ? 'N/A (graded)' : '—';
        return params.value ? format(String(params.value)) : '';
      };

    const text = (field: string, width: number, extra: Partial<ColDef<CardItemWithImages>> = {}): ColDef<CardItemWithImages> => ({
      headerName: HEADERS[field],
      field: field as keyof CardItemWithImages,
      width,
      editable: true,
      valueSetter: setter(field),
      cellClass: requiredClass(field),
      suppressSizeToFit: true,
      ...extra,
    });

    const suggest = (field: string, width: number, extra: Partial<ColDef<CardItemWithImages>> = {}) =>
      text(field, width, { cellEditor: SuggestEditor, cellEditorPopup: true, cellEditorPopupPosition: 'over', ...extra });

    const select = (
      field: string,
      width: number,
      options: typeof GRADER_FIELD_OPTIONS,
      extra: Partial<ColDef<CardItemWithImages>> = {}
    ): ColDef<CardItemWithImages> =>
      text(field, width, {
        cellEditor: TypeaheadEditor,
        cellEditorParams: { options, allowClear: field === 'grader' || field === 'grade' },
        cellEditorPopup: true,
        cellEditorPopupPosition: 'over',
        cellRenderer: SelectCell,
        ...extra,
      });

    const required = (col: ColDef<CardItemWithImages>) => ({ ...col, headerName: `${col.headerName}*` });

    return [
      {
        headerName: 'Photos*',
        colId: 'images',
        field: 'images',
        width: 100,
        maxWidth: 100,
        cellDataType: false,
        cellRenderer: ImageCell,
        sortable: false,
        filter: false,
        pinned: 'left',
        suppressSizeToFit: true,
        tooltipValueGetter: () => 'Click to show photos',
        cellClass: (params: CellClassParams<CardItemWithImages>) =>
          params.data && params.data.images.length === 0 ? 'cell-mandatory-empty' : '',
      },
      {
        headerName: 'Status',
        colId: 'status',
        width: 104,
        maxWidth: 120,
        pinned: 'left',
        cellDataType: false,
        cellRenderer: StatusCell,
        valueGetter: (params) => (params.data ? (params.data.ebayItemId ? -1 : missingFieldLabels(params.data).length) : 0),
        tooltipValueGetter: (params) => {
          if (!params.data || params.data.ebayItemId) return undefined;
          const missing = missingFieldLabels(params.data);
          return missing.length > 0 ? `Still needs: ${missing.join(', ')}` : 'Ready to list';
        },
        filter: false,
        suppressNavigable: true,
        suppressSizeToFit: true,
        headerTooltip: 'Sort to bring the cards that need the most work to the top',
      },
      {
        headerName: 'Title*',
        field: 'title',
        width: 520,
        minWidth: 360,
        flex: 1,
        editable: (params: EditableCallbackParams<CardItemWithImages>) =>
          Boolean(params.data && manualTitlesRef.current.has(params.data.id)),
        valueSetter: setter('title'),
        cellRenderer: TitleCell,
        headerTooltip: 'Built from Year, Set, Card #, Name, and Subset/Parallel. Click the lock to write your own. Max 80 characters.',
        cellClass: (params: CellClassParams<CardItemWithImages>) => {
          const title = params.data?.title || '';
          if (title.length > TITLE_MAX_LENGTH) return 'cell-title-over-limit';
          return title.trim() === '' ? 'cell-mandatory-empty' : '';
        },
      },
      required(
        text('salePrice', 110, {
          valueFormatter: (params) => (params.value === null || params.value === undefined ? '' : `$${Number(params.value).toFixed(2)}`),
        })
      ),
      required(select('category', 200, CATEGORY_FIELD_OPTIONS)),
      required(text('year', 90)),
      required(suggest('brand', 140)),
      required(suggest('setName', 160)),
      required(text('cardNumber', 100)),
      required(suggest('name', 180)),
      required(suggest('subsetParallel', 170)),
      required(
        select('conditionType', 130, CONDITION_TYPE_FIELD_OPTIONS, {
          valueFormatter: (params) => (params.value ? conditionTypeShortLabel(String(params.value)) : ''),
        })
      ),
      {
        ...select('condition', 190, CONDITION_FIELD_OPTIONS, {
          editable: appliesEditable('condition'),
          valueFormatter: naFormatter('condition', conditionShortLabel),
        }),
        headerName: 'Condition*',
        headerTooltip: 'Required for raw cards',
      },
      {
        ...select('grader', 110, GRADER_FIELD_OPTIONS, {
          editable: appliesEditable('grader'),
          valueFormatter: naFormatter('grader', graderShortLabel),
        }),
        headerTooltip: 'Required for graded cards',
      },
      {
        ...select('grade', 90, GRADE_FIELD_OPTIONS, {
          editable: appliesEditable('grade'),
          valueFormatter: naFormatter('grade'),
        }),
        headerTooltip: 'Required for graded cards',
      },
      text('certNo', 140, {
        editable: appliesEditable('certNo'),
        valueFormatter: naFormatter('certNo'),
      }),
      required(
        text('description', 300, {
          cellEditor: 'agLargeTextCellEditor',
          cellEditorPopup: true,
          cellEditorParams: { maxLength: 5000, rows: 6, cols: 60 },
          headerTooltip: 'Tokens like {title} or {grade} are filled in when you export or list',
        })
      ),
      suggest('team', 150, { initialHide: !initialShowMore }),
      suggest('variation', 150, { initialHide: !initialShowMore }),
      text('attributes', 170, { initialHide: !initialShowMore }),
    ];
  }, [initialShowMore]);

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      resizable: true,
      filter: true,
      suppressAutoSize: true,
      // Values are parsed by our own setters (so "$4.99" or "2023-24" work), not the grid's inferred number editors
      cellDataType: false,
      headerTooltip: 'Right-click to bulk edit',
    }),
    []
  );

  const rowClassRules = useMemo(
    () => ({ 'row-complete': (params: RowClassParams<CardItemWithImages>) => (params.data ? isCardComplete(params.data) : false) }),
    []
  );

  const bulkFields = useMemo<BulkField[]>(
    () =>
      Object.keys(HEADERS)
        .filter((field) => field !== 'title' && isFieldEditable(field))
        .map((field) => ({ field, headerName: HEADERS[field] })),
    []
  );

  // ── Helpers over the grid's current view ─────────────────────────────────
  const displayedNodes = useCallback((): IRowNode<CardItemWithImages>[] => {
    const nodes: IRowNode<CardItemWithImages>[] = [];
    api()?.forEachNodeAfterFilterAndSort((node) => {
      if (node.data) nodes.push(node);
    });
    return nodes;
  }, []);

  const selectedCards = useCallback(
    (): CardItemWithImages[] => (api()?.getSelectedNodes() ?? []).filter((n) => n.displayed && n.data).map((n) => n.data!),
    []
  );

  /** Builds updates for the given cards, skipping ones the field doesn't apply to. */
  const buildUpdates = useCallback((targets: CardItemWithImages[], field: string, value: unknown) => {
    const updates: CardUpdate[] = [];
    let skipped = 0;
    for (const card of targets) {
      const nextType = field === 'conditionType' ? value : card.conditionType;
      if (!fieldApplies(field, { conditionType: nextType as string })) {
        skipped++;
        continue;
      }
      updates.push({ id: card.id, data: { [field]: value } });
    }
    return { updates, skipped };
  }, []);

  const skippedNote = (field: string, skipped: number) =>
    skipped > 0 ? ` (skipped ${skipped} ${GRADED_ONLY.has(field) ? 'raw' : 'graded'})` : '';

  const handleBulkApply = useCallback(
    (field: string, value: unknown) => {
      const selected = selectedCards();
      const targets = selected.length > 0 ? selected : displayedNodes().map((n) => n.data!);
      const { updates, skipped } = buildUpdates(targets, field, value);
      onCardsChangeRef.current(updates);
      notifyRef.current(`Updated ${HEADERS[field]} on ${updates.length} ${updates.length === 1 ? 'card' : 'cards'}${skippedNote(field, skipped)}`);
    },
    [buildUpdates, displayedNodes, selectedCards]
  );

  const openBulkEdit = useCallback((field: string | null) => {
    const grid = api();
    setSelectedCount(grid?.getSelectedNodes().filter((n) => n.displayed).length ?? 0);
    setDisplayedCount(grid?.getDisplayedRowCount() ?? 0);
    setBulkField(field);
    setShowBulkEdit(true);
  }, []);

  // ── Fill down (Ctrl+D) ────────────────────────────────────────────────────
  const fillDown = useCallback(
    (rowIndex: number, field: string) => {
      const grid = api();
      if (!grid) return;
      if (!isFieldEditable(field) || field === 'title') {
        notifyRef.current('Fill down works on the data columns (not Photos or Title).');
        return;
      }
      const current = grid.getDisplayedRowAtIndex(rowIndex)?.data;
      if (!current) return;
      const selected = selectedCards();

      if (selected.length > 1) {
        const value = (current as Record<string, unknown>)[field] ?? null;
        const { updates, skipped } = buildUpdates(selected.filter((c) => c.id !== current.id), field, value);
        onCardsChangeRef.current(updates);
        notifyRef.current(`Copied ${HEADERS[field]} to ${updates.length} selected ${updates.length === 1 ? 'card' : 'cards'}${skippedNote(field, skipped)}`);
        return;
      }

      const above = rowIndex > 0 ? grid.getDisplayedRowAtIndex(rowIndex - 1)?.data : undefined;
      if (!above) return;
      const value = (above as Record<string, unknown>)[field] ?? null;
      const { updates } = buildUpdates([current], field, value);
      if (updates.length === 0) {
        notifyRef.current(`${HEADERS[field]} doesn't apply to this card.`);
        return;
      }
      onCardsChangeRef.current(updates);
      const next = rowIndex + 1;
      if (next < grid.getDisplayedRowCount()) {
        grid.ensureIndexVisible(next);
        grid.setFocusedCell(next, field);
      }
    },
    [buildUpdates, selectedCards]
  );

  // ── Next incomplete ───────────────────────────────────────────────────────
  const missingFieldFor = useCallback((card: CardItemWithImages): string | null => {
    for (const field of COMPLETENESS_FIELDS) {
      if (field === 'title') continue;
      const value = field === 'images' ? card.images : (card as Record<string, unknown>)[field];
      if (isMandatoryFieldEmpty(field, value, card)) return field;
    }
    return firstMissingField(card);
  }, []);

  const goToNextIncomplete = useCallback(() => {
    const grid = api();
    if (!grid) return;
    const count = grid.getDisplayedRowCount();
    if (count === 0) return;
    const focused = grid.getFocusedCell();
    let start = focused?.rowIndex ?? 0;
    const focusedCard = focused ? grid.getDisplayedRowAtIndex(focused.rowIndex)?.data : undefined;
    if (focusedCard && missingFieldFor(focusedCard) === focused?.column.getColId()) start++;
    for (let i = 0; i < count; i++) {
      const index = (start + i) % count;
      const card = grid.getDisplayedRowAtIndex(index)?.data;
      const field = card ? missingFieldFor(card) : null;
      if (field) {
        grid.ensureIndexVisible(index, 'middle');
        grid.ensureColumnVisible(field);
        grid.setFocusedCell(index, field);
        return;
      }
    }
    notifyRef.current('Every card shown is complete.');
  }, [missingFieldFor]);

  const toggleIncompleteOnly = useCallback(() => {
    const next = !incompleteIdsRef.current;
    incompleteIdsRef.current = next
      ? new Set(cardsRef.current.filter((card) => !isCardComplete(card)).map((card) => card.id))
      : null;
    setIncompleteOnly(next);
    api()?.onFilterChanged();
  }, []);

  const isExternalFilterPresent = useCallback(() => incompleteIdsRef.current !== null, []);
  const doesExternalFilterPass = useCallback(
    (node: IRowNode<CardItemWithImages>) => !node.data || !incompleteIdsRef.current || incompleteIdsRef.current.has(node.data.id),
    []
  );

  // ── Paste from a spreadsheet ──────────────────────────────────────────────
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const grid = api();
      if (!grid || grid.getEditingCells().length > 0) return;
      const focused = grid.getFocusedCell();
      const raw = e.clipboardData.getData('text/plain');
      if (!focused || !raw) return;
      e.preventDefault();

      const rows = raw.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').map((line) => line.split('\t'));
      const columns = grid.getAllDisplayedColumns();
      const startCol = columns.indexOf(focused.column);
      const selected = selectedCards();

      const targetRows: CardItemWithImages[][] = [];
      if (rows.length === 1 && rows[0].length === 1 && selected.length > 1) {
        targetRows.push(selected);
      } else {
        for (let r = 0; r < rows.length; r++) {
          const card = grid.getDisplayedRowAtIndex(focused.rowIndex + r)?.data;
          if (!card) break;
          targetRows.push([card]);
        }
      }

      const pending = new Map<string, Record<string, unknown>>();
      let pasted = 0;
      let skipped = 0;
      const overflowRows = rows.length === 1 ? 0 : rows.length - targetRows.length;

      targetRows.forEach((cardsInRow, r) => {
        const cells = rows.length === 1 ? rows[0] : rows[r];
        for (const card of cardsInRow) {
          cells.forEach((cellText, c) => {
            const field = columns[startCol + c]?.getColId();
            if (!field || !isFieldEditable(field)) {
              if (cellText.trim()) skipped++;
              return;
            }
            const data = pending.get(card.id) ?? {};
            const merged = { ...card, ...data };
            if (!fieldApplies(field, merged)) {
              if (cellText.trim()) skipped++;
              return;
            }
            const value = parseFieldValue(field, cellText);
            if (value === undefined) {
              if (cellText.trim()) skipped++;
              return;
            }
            if (field === 'title') manualTitlesRef.current.add(card.id);
            data[field] = value;
            pending.set(card.id, data);
            pasted++;
          });
        }
      });

      if (pending.size > 0) {
        onCardsChangeRef.current(Array.from(pending, ([id, data]) => ({ id, data })));
        grid.refreshCells({ columns: ['title'], force: true });
      }
      const parts = [`Pasted ${pasted} ${pasted === 1 ? 'value' : 'values'}`];
      if (skipped > 0) parts.push(`skipped ${skipped} that didn't fit their column`);
      if (overflowRows > 0) parts.push(`${overflowRows} rows past the last card were ignored`);
      if (pasted !== 1 || skipped > 0 || overflowRows > 0) notifyRef.current(parts.join(' · '));
    },
    [selectedCards]
  );

  // ── Grid events ───────────────────────────────────────────────────────────
  const onCellKeyDown = useCallback(
    (event: CellKeyDownEvent<CardItemWithImages>) => {
      const key = event.event as KeyboardEvent | undefined;
      if (!key || event.rowIndex === null || event.api.getEditingCells().length > 0) return;
      if ((key.ctrlKey || key.metaKey) && key.key.toLowerCase() === 'd') {
        key.preventDefault();
        fillDown(event.rowIndex, event.column.getColId());
      } else if (key.altKey && key.key.toLowerCase() === 'n') {
        key.preventDefault();
        goToNextIncomplete();
      }
    },
    [fillDown, goToNextIncomplete]
  );

  const onCellClicked = useCallback((event: CellClickedEvent<CardItemWithImages>) => {
    setContextMenu(null);
    if (event.column.getColId() === 'images' && event.data) {
      setFocusedCardId(event.data.id);
      setShowPhotos(true);
      writeSetting(STORAGE_KEYS.photos, 'on');
    }
  }, []);

  const onCellFocused = useCallback((event: CellFocusedEvent<CardItemWithImages>) => {
    if (event.rowIndex === null || event.rowIndex === undefined) return;
    const id = event.api.getDisplayedRowAtIndex(event.rowIndex)?.data?.id;
    if (id) setFocusedCardId(id);
  }, []);

  const onCellContextMenu = useCallback((event: CellContextMenuEvent<CardItemWithImages>) => {
    if (!event.data) return;
    const mouse = event.event as MouseEvent | undefined;
    mouse?.preventDefault();
    setContextMenu({
      x: mouse?.clientX ?? 0,
      y: mouse?.clientY ?? 0,
      cardId: event.data.id,
      label: event.data.title || event.data.name || `Card #${event.data.cardNumber || event.data.id.slice(0, 8)}`,
    });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  const onCellValueChanged = useCallback((event: CellValueChangedEvent<CardItemWithImages>) => {
    if (event.column.getColId() !== 'conditionType') return;
    const node = event.node;
    setTimeout(() => {
      event.api.refreshCells({ rowNodes: [node], columns: ['condition', 'grader', 'grade', 'certNo'], force: true });
    }, 50);
  }, []);

  const onHeaderContextMenu = useCallback(
    (event: React.MouseEvent) => {
      const header = (event.target as HTMLElement).closest('.ag-header-cell');
      if (!header) return;
      event.preventDefault();
      const colId = header.getAttribute('col-id');
      if (colId && bulkFields.some((f) => f.field === colId)) openBulkEdit(colId);
    },
    [bulkFields, openBulkEdit]
  );

  // Runs in the capture phase, before the grid handles the key: the key that starts an edit sees
  // no editing cell and resets the buffer; keys after it (still aimed at the cell) are collected.
  const captureTypedAhead = useCallback((e: React.KeyboardEvent) => {
    if (!(e.target as HTMLElement).classList?.contains('ag-cell')) return;
    const editing = (api()?.getEditingCells().length ?? 0) > 0;
    const buffer = typedAheadRef.current;
    if (!editing) {
      typedAheadRef.current = { text: '', enter: false };
    } else if (e.key === 'Enter' && buffer.text) {
      // Enter before a popup editor has mounted would commit the old value; let the editor commit instead
      e.preventDefault();
      e.stopPropagation();
      buffer.enter = true;
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      buffer.text += e.key;
    }
  }, []);

  const onSelectionChanged = useCallback((event: SelectionChangedEvent<CardItemWithImages>) => {
    setSelectedCount(event.api.getSelectedNodes().length);
  }, []);

  const onModelUpdated = useCallback((event: ModelUpdatedEvent<CardItemWithImages>) => {
    setDisplayedCount(event.api.getDisplayedRowCount());
  }, []);

  const tabToNextCell = useCallback((params: TabToNextCellParams) => {
    const { backwards, nextCellPosition, previousCellPosition } = params;
    if (tabDirectionRef.current === 'across' || !previousCellPosition) return nextCellPosition ?? false;
    const rowCount = params.api.getDisplayedRowCount();
    let row = previousCellPosition.rowIndex + (backwards ? -1 : 1);
    if (row < 0) row = rowCount - 1;
    if (row >= rowCount) row = 0;
    return { rowIndex: row, column: previousCellPosition.column, rowPinned: null };
  }, []);

  useEffect(() => {
    api()?.setColumnsVisible(EXTRA_COLUMNS, showMoreColumns);
  }, [showMoreColumns]);

  const photoCard = useMemo(
    () => (focusedCardId ? cards.find((card) => card.id === focusedCardId) ?? null : null),
    [cards, focusedCardId]
  );

  const selectionScope =
    selectedCount > 0
      ? `Applies to the ${selectedCount} selected ${selectedCount === 1 ? 'card' : 'cards'}.`
      : `No rows are selected, so this applies to all ${displayedCount} ${displayedCount === 1 ? 'card' : 'cards'} shown.`;

  const toolbarButton = (active: boolean) =>
    `inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors ${
      active
        ? 'bg-primary-500/15 text-primary-200 ring-1 ring-inset ring-primary-500/40'
        : 'text-surface-300 hover:text-white hover:bg-white/[0.06]'
    }`;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center gap-1 px-2.5 py-2 border-b border-white/[0.06] bg-white/[0.015]">
        <button onClick={toggleIncompleteOnly} className={toolbarButton(incompleteOnly)} title="Show only cards that still need fields">
          <span className={`w-1.5 h-1.5 rounded-full ${incompleteCount > 0 ? 'bg-amber-400' : 'bg-emerald-400'}`} />
          Needs work
          {incompleteCount > 0 && <span className="tabular-nums text-surface-400">{incompleteCount}</span>}
        </button>
        <button onClick={goToNextIncomplete} className={toolbarButton(false)} title="Jump to the next empty required field (Alt+N)">
          Next empty field
          <kbd className="kbd">Alt N</kbd>
        </button>
        <span className="w-px h-4 bg-white/10 mx-1.5" />
        <button onClick={() => openBulkEdit(api()?.getFocusedCell()?.column.getColId() ?? null)} className={toolbarButton(selectedCount > 0)}>
          {selectedCount > 0 ? `Edit ${selectedCount} selected` : 'Bulk edit'}
        </button>
        {selectedCount > 0 && (
          <button onClick={() => api()?.deselectAll()} className="text-xs text-surface-400 hover:text-surface-200 px-1.5">
            Clear
          </button>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <span className="hidden xl:flex items-center gap-1.5 text-[11px] text-surface-500 mr-1.5" title="Paste works from Excel or Google Sheets starting at the focused cell">
            <kbd className="kbd">Ctrl D</kbd> fill down
            <kbd className="kbd ml-1.5">Ctrl V</kbd> paste cells
          </span>
          <div className="flex items-center p-0.5 rounded-lg bg-white/[0.04] ring-1 ring-inset ring-white/[0.06] text-xs" title="Where Tab moves after you enter a value">
            <span className="px-2 text-surface-500">Tab</span>
            {(['down', 'across'] as const).map((direction) => (
              <button
                key={direction}
                onClick={() => {
                  setTabDirection(direction);
                  writeSetting(STORAGE_KEYS.tab, direction);
                }}
                className={`h-6 px-2 rounded-md capitalize transition-colors ${
                  tabDirection === direction ? 'bg-white/[0.1] text-white shadow-sm' : 'text-surface-400 hover:text-surface-100'
                }`}
              >
                {direction}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              const next = !showMoreColumns;
              setShowMoreColumns(next);
              writeSetting(STORAGE_KEYS.moreColumns, next ? 'on' : 'off');
            }}
            className={toolbarButton(showMoreColumns)}
            title="Team, Variation, Attributes"
          >
            More columns
          </button>
          <button
            onClick={() => {
              const next = !showPhotos;
              setShowPhotos(next);
              writeSetting(STORAGE_KEYS.photos, next ? 'on' : 'off');
            }}
            className={toolbarButton(showPhotos)}
          >
            <PhotosIcon size={14} />
            Photos
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="ag-theme-alpine-dark flex-1 min-w-0 h-full" onContextMenu={onHeaderContextMenu}
          onPaste={handlePaste}
          onKeyDownCapture={captureTypedAhead}
        >
          <AgGridReact<CardItemWithImages>
            ref={gridRef}
            rowData={cards}
            columnDefs={columns}
            defaultColDef={defaultColDef}
            context={gridContext}
            getRowId={getRowId}
            onCellClicked={onCellClicked}
            onCellFocused={onCellFocused}
            onCellKeyDown={onCellKeyDown}
            onCellContextMenu={onCellContextMenu}
            onCellValueChanged={onCellValueChanged}
            onSelectionChanged={onSelectionChanged}
            onModelUpdated={onModelUpdated}
            rowSelection={ROW_SELECTION}
            selectionColumnDef={SELECTION_COLUMN}
            isExternalFilterPresent={isExternalFilterPresent}
            doesExternalFilterPass={doesExternalFilterPass}
            quickFilterText={searchText}
            animateRows={true}
            stopEditingWhenCellsLoseFocus={true}
            enterNavigatesVertically={true}
            enterNavigatesVerticallyAfterEdit={true}
            tooltipShowDelay={500}
            rowClassRules={rowClassRules}
            suppressContextMenu={true}
            tabToNextCell={tabToNextCell}
            maintainColumnOrder={true}
            suppressColumnMoveAnimation={true}
          />
        </div>
        {showPhotos && (
          <PhotoPanel
            card={photoCard}
            onClose={() => {
              setShowPhotos(false);
              writeSetting(STORAGE_KEYS.photos, 'off');
            }}
          />
        )}
      </div>

      <BulkEditModal
        isOpen={showBulkEdit}
        fields={bulkFields}
        initialField={bulkField && bulkFields.some((f) => f.field === bulkField) ? bulkField : null}
        targetCount={selectedCount > 0 ? selectedCount : displayedCount}
        scopeLabel={selectionScope}
        onClose={() => setShowBulkEdit(false)}
        onApply={handleBulkApply}
      />

      {contextMenu && (
        <div
          className="fixed z-50 rounded-xl border border-white/10 bg-surface-850/95 backdrop-blur-xl p-1.5 shadow-pop animate-scale-in"
          style={{ left: contextMenu.x, top: contextMenu.y, minWidth: '190px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2.5 pt-1.5 pb-2">
            <span className="text-xs text-surface-400 truncate block max-w-[200px]">{contextMenu.label}</span>
          </div>
          <button
            onClick={() => {
              onCloneCard(contextMenu.cardId);
              setContextMenu(null);
            }}
            className="menu-item"
          >
            <svg className="w-4 h-4 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span>Clone row</span>
          </button>
          <button
            onClick={() => {
              onDeleteCard(contextMenu.cardId);
              setContextMenu(null);
            }}
            className="menu-item text-red-300 hover:!text-red-200 hover:!bg-red-500/10"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>Delete row</span>
          </button>
        </div>
      )}
    </div>
  );
}

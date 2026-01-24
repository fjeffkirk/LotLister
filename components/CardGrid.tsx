'use client';

import { useRef, useCallback, useMemo, useState, useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ColDef,
  ICellRendererParams,
  ValueSetterParams,
  GridReadyEvent,
  CellClickedEvent,
  CellContextMenuEvent,
  CellValueChangedEvent,
  CellClassParams,
  RowClassParams,
  TabToNextCellParams,
  CellFocusedEvent,
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { CardItemWithImages, CardImage, CATEGORY_OPTIONS, CONDITION_TYPE_OPTIONS, CONDITION_OPTIONS, GRADER_OPTIONS, GRADE_OPTIONS } from '../lib/types';

// Get image URL (client-side utility)
function getImageUrl(relativePath: string): string {
  return `/api/images/${encodeURIComponent(relativePath)}`;
}

// Mandatory fields for eBay listings
const MANDATORY_FIELDS = [
  'title', 'salePrice', 'year', 'conditionType', 'category', 
  'brand', 'setName', 'name', 'cardNumber', 'subsetParallel'
] as const;

// Generate auto-title from card fields: Year, Set, Name, Card #, Subset/Parallel
function generateAutoTitle(card: CardItemWithImages): string {
  const parts: string[] = [];
  
  if (card.year) parts.push(String(card.year));
  if (card.setName?.trim()) parts.push(card.setName.trim());
  if (card.name?.trim()) parts.push(card.name.trim());
  if (card.cardNumber?.trim()) parts.push(`#${card.cardNumber.trim()}`);
  if (card.subsetParallel?.trim()) parts.push(card.subsetParallel.trim());
  
  return parts.join(' ');
}

// Conditionally required fields (when graded)
const GRADED_REQUIRED_FIELDS = ['grader', 'grade'] as const;

// Conditionally required fields (when ungraded)
const UNGRADED_REQUIRED_FIELDS = ['condition'] as const;

// Check if a card is graded (based on conditionType)
function isCardGraded(card: CardItemWithImages): boolean {
  return (card as Record<string, unknown>).conditionType === 'Graded: Professionally graded';
}

// Check if a card has all mandatory fields filled
function isCardComplete(card: CardItemWithImages): boolean {
  // Must have at least one image
  if (!card.images || card.images.length === 0) return false;
  
  // Check all mandatory text/select fields
  if (!card.title || card.title.trim() === '') return false;
  if (card.salePrice === null || card.salePrice === undefined) return false;
  if (card.year === null || card.year === undefined) return false;
  const conditionType = (card as Record<string, unknown>).conditionType as string | undefined;
  if (!conditionType || conditionType.trim() === '') return false;
  if (!card.category || card.category.trim() === '') return false;
  if (!card.brand || card.brand.trim() === '') return false;
  if (!card.setName || card.setName.trim() === '') return false;
  if (!card.name || card.name.trim() === '') return false;
  if (!card.cardNumber || card.cardNumber.trim() === '') return false;
  if (!card.subsetParallel || card.subsetParallel.trim() === '') return false;
  
  // If graded, grader and grade are required
  if (isCardGraded(card)) {
    if (!card.grader || card.grader.trim() === '') return false;
    const grade = (card as Record<string, unknown>).grade as string | undefined;
    if (!grade || grade.trim() === '') return false;
  } else {
    // If ungraded, condition is required
    if (!card.condition || card.condition.trim() === '') return false;
  }
  
  return true;
}

// Check if a specific field is mandatory and empty
function isMandatoryFieldEmpty(field: string, value: unknown, card: CardItemWithImages): boolean {
  // Special case for images
  if (field === 'images') {
    return !card.images || card.images.length === 0;
  }
  
  // Check if field is conditionally required (graded fields)
  if (GRADED_REQUIRED_FIELDS.includes(field as typeof GRADED_REQUIRED_FIELDS[number])) {
    // Only required if graded
    if (!isCardGraded(card)) return false;
    
    // Check if value is empty
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    return false;
  }
  
  // Check if field is conditionally required (ungraded fields)
  if (UNGRADED_REQUIRED_FIELDS.includes(field as typeof UNGRADED_REQUIRED_FIELDS[number])) {
    // Only required if NOT graded
    if (isCardGraded(card)) return false;
    
    // Check if value is empty
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    return false;
  }
  
  // Check if field is in mandatory list
  if (!MANDATORY_FIELDS.includes(field as typeof MANDATORY_FIELDS[number])) {
    return false;
  }
  
  // Check if value is empty
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (typeof value === 'number' && isNaN(value)) return true;
  
  return false;
}

// Draggable Image Preview Popup
function ImagePreviewPopup({
  images,
  cardTitle,
  onClose,
}: {
  images: CardImage[];
  cardTitle: string;
  onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 20, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // Handle mouse down on header to start dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  }, [position]);

  // Handle mouse move while dragging
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && currentImageIndex > 0) {
        setCurrentImageIndex(prev => prev - 1);
      }
      if (e.key === 'ArrowRight' && currentImageIndex < images.length - 1) {
        setCurrentImageIndex(prev => prev + 1);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, currentImageIndex, images.length]);

  if (images.length === 0) return null;

  const currentImage = images[currentImageIndex];

  return (
    <div
      ref={popupRef}
      className="fixed z-50 bg-surface-900 border border-surface-600 rounded-lg shadow-2xl overflow-hidden"
      style={{
        left: position.x,
        top: position.y,
        width: '400px',
        cursor: isDragging ? 'grabbing' : 'default',
      }}
    >
      {/* Draggable Header */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-surface-800 border-b border-surface-700 cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 text-surface-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
          </svg>
          <span className="text-sm font-medium text-surface-200 truncate">
            {cardTitle || 'Card Preview'}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Main Image */}
      <div className="relative bg-black">
        <img
          src={getImageUrl(currentImage.originalPath)}
          alt={`Card image ${currentImageIndex + 1}`}
          className="w-full h-auto max-h-[500px] object-contain"
        />
        
        {/* Navigation arrows */}
        {images.length > 1 && (
          <>
            <button
              onClick={() => setCurrentImageIndex(prev => Math.max(0, prev - 1))}
              disabled={currentImageIndex === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/60 rounded-full text-white hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={() => setCurrentImageIndex(prev => Math.min(images.length - 1, prev + 1))}
              disabled={currentImageIndex === images.length - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/60 rounded-full text-white hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div className="flex gap-2 p-3 bg-surface-800/50 border-t border-surface-700 overflow-x-auto">
          {images.map((img, idx) => (
            <button
              key={img.id}
              onClick={() => setCurrentImageIndex(idx)}
              className={`w-14 h-14 flex-shrink-0 rounded overflow-hidden border-2 transition-all ${
                idx === currentImageIndex
                  ? 'border-primary-500 ring-2 ring-primary-500/30'
                  : 'border-surface-600 hover:border-surface-500'
              }`}
            >
              <img
                src={getImageUrl(img.thumbPath)}
                alt={`Thumbnail ${idx + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {/* Image counter */}
      <div className="px-3 py-2 bg-surface-800 border-t border-surface-700 text-center text-xs text-surface-400">
        Image {currentImageIndex + 1} of {images.length} • Use ← → arrows to navigate
      </div>
    </div>
  );
}

interface CardGridProps {
  cards: CardItemWithImages[];
  onCellChange: (cardId: string, field: string, value: unknown) => void;
  onBulkEdit: (field: string, value: unknown) => void;
  onCloneCard: (cardId: string) => void;
  onDeleteCard: (cardId: string) => void;
  searchText: string;
}

// Column field info for bulk edit
interface ColumnInfo {
  field: string;
  headerName: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  options?: readonly string[] | boolean[];
}

// Image cell renderer - clickable to open preview
function ImageCellRenderer(props: ICellRendererParams<CardItemWithImages>) {
  const images = props.data?.images || [];
  
  if (images.length === 0) {
    return (
      <div className="flex items-center gap-1 py-1">
        <div className="w-10 h-10 bg-surface-700 rounded flex items-center justify-center">
          <svg className="w-5 h-5 text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex items-center gap-1 py-1 cursor-pointer group">
      {images.slice(0, 2).map((img, idx) => (
        <div key={img.id} className="w-10 h-10 bg-surface-700 rounded overflow-hidden flex-shrink-0 ring-0 group-hover:ring-2 group-hover:ring-primary-500/50 transition-all">
          <img
            src={getImageUrl(img.thumbPath)}
            alt={`Image ${idx + 1}`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      ))}
      {images.length > 2 && (
        <span className="text-xs text-surface-400 ml-1">
          +{images.length - 2}
        </span>
      )}
    </div>
  );
}

// Bulk Edit Modal Component
function BulkEditModal({
  isOpen,
  column,
  itemCount,
  onClose,
  onApply,
}: {
  isOpen: boolean;
  column: ColumnInfo | null;
  itemCount: number;
  onClose: () => void;
  onApply: (value: unknown) => void;
}) {
  const [value, setValue] = useState<string>('');
  
  if (!isOpen || !column) return null;
  
  const handleApply = () => {
    let finalValue: unknown = value;
    
    if (column.type === 'number') {
      finalValue = value === '' ? null : parseFloat(value);
    } else if (column.type === 'boolean') {
      finalValue = value === 'true' || value === 'Yes';
    } else if (value === '') {
      finalValue = null;
    }
    
    onApply(finalValue);
    setValue('');
    onClose();
  };
  
  const handleClose = () => {
    setValue('');
    onClose();
  };
  
  return (
    <div className="modal-overlay animate-fade-in" onClick={handleClose}>
      <div
        className="modal-content w-full max-w-md p-6 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Bulk Edit</h2>
          <button onClick={handleClose} className="btn-ghost p-1 rounded">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-surface-300 mb-2">
            Set "{column.headerName}" for all {itemCount} items:
          </label>
          
          {column.type === 'select' || column.type === 'boolean' ? (
            <select
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full"
              autoFocus
            >
              <option value="">-- Select --</option>
              {column.type === 'boolean' ? (
                <>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </>
              ) : (
                column.options?.map((opt) => (
                  <option key={String(opt)} value={String(opt)}>
                    {String(opt)}
                  </option>
                ))
              )}
            </select>
          ) : (
            <input
              type={column.type === 'number' ? 'number' : 'text'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full"
              placeholder={`Enter ${column.headerName.toLowerCase()}...`}
              autoFocus
              step={column.type === 'number' ? '0.01' : undefined}
            />
          )}
        </div>
        
        <div className="flex justify-end gap-3">
          <button onClick={handleClose} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={handleApply} className="btn btn-primary">
            Update {itemCount} Items
          </button>
        </div>
      </div>
    </div>
  );
}

// Grid context type for passing state to cell renderers without recreating columns
interface GridContext {
  unlockedTitles: Set<string>;
  toggleTitleLock: (cardId: string, card: CardItemWithImages) => void;
  onCellChange: (cardId: string, field: string, value: unknown) => void;
}

export default function CardGrid({ cards, onCellChange, onBulkEdit, onCloneCard, onDeleteCard, searchText }: CardGridProps) {
  const gridRef = useRef<AgGridReact>(null);
  const [bulkEditColumn, setBulkEditColumn] = useState<ColumnInfo | null>(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [previewCard, setPreviewCard] = useState<CardItemWithImages | null>(null);
  
  // Row context menu state
  const [contextMenu, setContextMenu] = useState<{
    show: boolean;
    x: number;
    y: number;
    cardId: string;
    cardTitle: string;
  } | null>(null);
  
  // Track which cards have their title unlocked for manual editing
  // By default, all titles are "locked" (auto-generated from other fields)
  const [unlockedTitles, setUnlockedTitles] = useState<Set<string>>(new Set());
  
  // Use ref to avoid recreating columns when lock state changes
  const unlockedTitlesRef = useRef<Set<string>>(unlockedTitles);
  unlockedTitlesRef.current = unlockedTitles;
  
  // Toggle title lock state
  const toggleTitleLock = useCallback((cardId: string, card: CardItemWithImages) => {
    setUnlockedTitles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(cardId)) {
        // Locking: revert to auto-generated title
        newSet.delete(cardId);
        const autoTitle = generateAutoTitle(card);
        onCellChange(cardId, 'title', autoTitle);
      } else {
        // Unlocking: allow manual editing
        newSet.add(cardId);
      }
      return newSet;
    });
    // Force grid to refresh the cell to update the icon
    gridRef.current?.api?.refreshCells({ columns: ['title'], force: true });
  }, [onCellChange]);
  
  // Grid context - passed to cell renderers via AG Grid's context prop
  const gridContext = useMemo<GridContext>(() => ({
    unlockedTitles: unlockedTitlesRef.current,
    toggleTitleLock,
    onCellChange,
  }), [toggleTitleLock, onCellChange]);
  
  // Track last auto-generated titles to prevent unnecessary updates
  const lastAutoTitles = useRef<Map<string, string>>(new Map());
  
  // Auto-update titles for locked cards when relevant fields change
  useEffect(() => {
    const updates: { id: string; title: string }[] = [];
    
    cards.forEach(card => {
      if (!unlockedTitles.has(card.id)) {
        const autoTitle = generateAutoTitle(card);
        const lastAutoTitle = lastAutoTitles.current.get(card.id);
        
        // Only update if:
        // 1. We have auto-generated data
        // 2. The auto-title is different from what we last set
        // 3. The current title doesn't match what it should be
        if (autoTitle && autoTitle !== lastAutoTitle && card.title !== autoTitle) {
          updates.push({ id: card.id, title: autoTitle });
          lastAutoTitles.current.set(card.id, autoTitle);
        }
      }
    });
    
    // Batch the updates
    updates.forEach(({ id, title }) => {
      onCellChange(id, 'title', title);
    });
  }, [cards, unlockedTitles, onCellChange]);

  // Handle cell click - open/update image preview
  const onCellClicked = useCallback((event: CellClickedEvent<CardItemWithImages>) => {
    // Close context menu if open
    setContextMenu(null);
    
    // If clicking on images column, always open/update preview (if card has images)
    if (event.column.getColId() === 'images') {
      if (event.data && event.data.images.length > 0) {
        setPreviewCard(event.data);
      }
      return;
    }
    
    // If preview is already open, update it to show the clicked row's images
    // This allows users to keep the preview open while navigating rows
    if (previewCard && event.data && event.data.images.length > 0) {
      // Only update if it's a different card
      if (event.data.id !== previewCard.id) {
        setPreviewCard(event.data);
      }
    }
  }, [previewCard]);

  // Handle cell focus change - update image preview when navigating with Tab
  const onCellFocused = useCallback((event: CellFocusedEvent<CardItemWithImages>) => {
    // Only update if preview is already open
    if (!previewCard) return;
    
    // Get the row data for the focused cell
    if (event.rowIndex !== null && event.rowIndex !== undefined) {
      const rowNode = event.api.getDisplayedRowAtIndex(event.rowIndex);
      if (rowNode && rowNode.data && rowNode.data.images.length > 0) {
        // Only update if it's a different card
        if (rowNode.data.id !== previewCard.id) {
          setPreviewCard(rowNode.data);
        }
      }
    }
  }, [previewCard]);

  // Handle row right-click for context menu
  const onCellContextMenu = useCallback((event: CellContextMenuEvent<CardItemWithImages>) => {
    if (!event.data) return;
    
    // Prevent default browser context menu
    event.event?.preventDefault();
    
    const mouseEvent = event.event as MouseEvent;
    setContextMenu({
      show: true,
      x: mouseEvent.clientX,
      y: mouseEvent.clientY,
      cardId: event.data.id,
      cardTitle: event.data.title || event.data.name || `Card #${event.data.cardNumber || event.data.id.slice(0, 8)}`,
    });
  }, []);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    const handleScroll = () => setContextMenu(null);
    
    if (contextMenu?.show) {
      document.addEventListener('click', handleClick);
      document.addEventListener('scroll', handleScroll, true);
      return () => {
        document.removeEventListener('click', handleClick);
        document.removeEventListener('scroll', handleScroll, true);
      };
    }
  }, [contextMenu?.show]);

  // Handle clone card
  const handleCloneCard = useCallback(() => {
    if (contextMenu?.cardId) {
      onCloneCard(contextMenu.cardId);
      setContextMenu(null);
    }
  }, [contextMenu?.cardId, onCloneCard]);

  // Handle delete card
  const handleDeleteCard = useCallback(() => {
    if (contextMenu?.cardId) {
      onDeleteCard(contextMenu.cardId);
      setContextMenu(null);
    }
  }, [contextMenu?.cardId, onDeleteCard]);

  // Handle cell value changes - refresh condition-related cells when conditionType changes
  const onCellValueChanged = useCallback((event: CellValueChangedEvent<CardItemWithImages>) => {
    if (event.column.getColId() === 'conditionType' && event.node?.id) {
      // Refresh the condition-related cells in this row
      const rowNode = event.api.getRowNode(event.node.id);
      if (rowNode) {
        setTimeout(() => {
          event.api.refreshCells({
            rowNodes: [rowNode],
            columns: ['condition', 'grader', 'grade', 'certNo'],
            force: true,
          });
        }, 50);
      }
    }
  }, []);

  // Column info mapping for bulk edit
  const columnInfoMap: Record<string, ColumnInfo> = {
    title: { field: 'title', headerName: 'Title', type: 'text' },
    salePrice: { field: 'salePrice', headerName: 'Price', type: 'number' },
    year: { field: 'year', headerName: 'Year', type: 'number' },
    brand: { field: 'brand', headerName: 'Brand', type: 'text' },
    setName: { field: 'setName', headerName: 'Set', type: 'text' },
    cardNumber: { field: 'cardNumber', headerName: 'Card #', type: 'text' },
    name: { field: 'name', headerName: 'Name', type: 'text' },
    team: { field: 'team', headerName: 'Team', type: 'text' },
    subsetParallel: { field: 'subsetParallel', headerName: 'Subset/Parallel', type: 'text' },
    variation: { field: 'variation', headerName: 'Variation', type: 'text' },
    category: { field: 'category', headerName: 'Category', type: 'select', options: CATEGORY_OPTIONS },
    conditionType: { field: 'conditionType', headerName: 'Condition Type', type: 'select', options: CONDITION_TYPE_OPTIONS },
    condition: { field: 'condition', headerName: 'Card Condition', type: 'select', options: CONDITION_OPTIONS },
    grader: { field: 'grader', headerName: 'Professional Grader', type: 'select', options: GRADER_OPTIONS },
    grade: { field: 'grade', headerName: 'Grade', type: 'select', options: GRADE_OPTIONS },
    certNo: { field: 'certNo', headerName: 'Certification Number', type: 'text' },
    attributes: { field: 'attributes', headerName: 'Attributes', type: 'text' },
  };

  // Handle header right-click for bulk edit (left-click still sorts)
  const onColumnHeaderContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    
    // Find the column from the clicked header
    const target = event.target as HTMLElement;
    const headerCell = target.closest('.ag-header-cell');
    if (!headerCell) return;
    
    const colId = headerCell.getAttribute('col-id');
    if (!colId || colId === 'images') return;
    
    const columnInfo = columnInfoMap[colId];
    if (columnInfo) {
      setBulkEditColumn(columnInfo);
      setShowBulkEdit(true);
    }
  }, []);

  // Handle bulk edit apply
  const handleBulkEditApply = useCallback((value: unknown) => {
    if (bulkEditColumn) {
      onBulkEdit(bulkEditColumn.field, value);
    }
  }, [bulkEditColumn, onBulkEdit]);

  // Value setter helper
  const createValueSetter = (field: string) => (params: ValueSetterParams<CardItemWithImages>) => {
    if (params.data && params.newValue !== params.oldValue) {
      onCellChange(params.data.id, field, params.newValue);
      return true;
    }
    return false;
  };

  // Cell class for mandatory fields - shows red when empty
  const getMandatoryCellClass = (field: string) => (params: CellClassParams<CardItemWithImages>) => {
    if (params.data && isMandatoryFieldEmpty(field, params.value, params.data)) {
      return 'cell-mandatory-empty';
    }
    return '';
  };

  // Row class rules - green when all mandatory fields are filled
  const rowClassRules = useMemo(() => ({
    'row-complete': (params: RowClassParams<CardItemWithImages>) => {
      return params.data ? isCardComplete(params.data) : false;
    },
  }), []);

  // All columns combined - widths set to show full header text (50% larger than original)
  // Right-click any header (except Images) to bulk edit
  // Order: Images, Title, Sale Price, Category, Year, Brand, Set, Name, Card #, Subset/Parallel, Attributes, Team, then rest
  const columns: ColDef<CardItemWithImages>[] = useMemo(() => [
    {
      headerName: 'Images*',
      field: 'images',
      width: 100,
      minWidth: 100,
      maxWidth: 100,
      cellRenderer: ImageCellRenderer,
      sortable: false,
      filter: false,
      pinned: 'left',
      suppressSizeToFit: true,
      tooltipValueGetter: () => 'Click to enlarge (Required)',
      cellClass: (params: CellClassParams<CardItemWithImages>) => {
        if (params.data && (!params.data.images || params.data.images.length === 0)) {
          return 'cell-mandatory-empty';
        }
        return '';
      },
    },
    {
      headerName: 'Title*',
      field: 'title',
      width: 700,
      minWidth: 500,
      flex: 1,
      editable: false, // We handle editing in our custom renderer
      cellRenderer: (params: ICellRendererParams<CardItemWithImages>) => {
        const card = params.data;
        const context = params.context as GridContext;
        if (!card || !context) return null;
        
        // Get lock state from context (via ref, so columns don't recreate)
        const isUnlocked = unlockedTitlesRef.current.has(card.id);
        const displayTitle = card.title || '';
        const charCount = displayTitle.length;
        const isOverLimit = charCount > 80;
        
        const [isEditing, setIsEditing] = useState(false);
        const [editValue, setEditValue] = useState(displayTitle);
        const inputRef = useRef<HTMLInputElement>(null);
        
        useEffect(() => {
          if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
          }
        }, [isEditing]);
        
        useEffect(() => {
          setEditValue(displayTitle);
        }, [displayTitle]);
        
        const handleSave = () => {
          if (editValue !== displayTitle) {
            context.onCellChange(card.id, 'title', editValue);
          }
          setIsEditing(false);
        };
        
        const handleKeyDown = (e: React.KeyboardEvent) => {
          if (e.key === 'Enter') {
            handleSave();
          } else if (e.key === 'Escape') {
            setEditValue(displayTitle);
            setIsEditing(false);
          }
        };
        
        // If editing (unlocked mode)
        if (isEditing && isUnlocked) {
          const editCharCount = editValue.length;
          const editOverLimit = editCharCount > 80;
          
          return (
            <div 
              className="flex items-center gap-2 w-full h-full px-1 -mx-1 rounded"
              style={{ backgroundColor: editOverLimit ? 'rgba(239, 68, 68, 0.2)' : 'transparent' }}
            >
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-surface-700 border border-primary-500 rounded px-2 py-1 text-surface-100 text-sm outline-none"
                style={{ minWidth: 0 }}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  context.toggleTitleLock(card.id, card);
                }}
                className="p-1 rounded hover:bg-surface-700 text-primary-400 flex-shrink-0"
                title="Lock to auto-generate title"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                </svg>
              </button>
              <span className="text-surface-500 text-xs flex-shrink-0 tabular-nums" title="eBay allows 80 characters max">
                {editCharCount}/80
              </span>
            </div>
          );
        }
        
        return (
          <div 
            className="flex items-center gap-2 w-full h-full group px-1 -mx-1 rounded"
            style={{ backgroundColor: isOverLimit ? 'rgba(239, 68, 68, 0.2)' : 'transparent' }}
          >
            <div 
              className={`flex-1 truncate ${isUnlocked ? 'cursor-text' : ''}`}
              onClick={() => isUnlocked && setIsEditing(true)}
              title={displayTitle || (isUnlocked ? 'Click to edit' : 'Add data to the right to create a title or unlock to write your own')}
            >
              {displayTitle ? (
                <span className="text-surface-100">{displayTitle}</span>
              ) : (
                <span className="text-surface-500 text-sm italic">
                  {isUnlocked ? 'Click to edit...' : 'Add data to the right or unlock →'}
                </span>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                context.toggleTitleLock(card.id, card);
              }}
              className={`p-1 rounded hover:bg-surface-700 transition-colors flex-shrink-0 ${
                isUnlocked ? 'text-primary-400' : 'text-surface-500 hover:text-surface-300'
              }`}
              title={isUnlocked ? 'Lock to auto-generate title' : 'Unlock to edit manually'}
            >
              {isUnlocked ? (
                // Unlocked icon (open padlock)
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                </svg>
              ) : (
                // Locked icon (closed padlock)
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              )}
            </button>
            <span className="text-surface-500 text-xs flex-shrink-0 tabular-nums" title="eBay allows 80 characters max">
              {charCount}/80
            </span>
          </div>
        );
      },
      headerTooltip: 'Auto-generated from Year, Set, Name, Card #, Subset/Parallel. Click lock icon to edit manually. Max 80 characters.',
      cellClass: getMandatoryCellClass('title'),
    },
    {
      headerName: 'Sale Price*',
      field: 'salePrice',
      width: 150,
      minWidth: 120,
      editable: true,
      valueFormatter: (params) => params.value ? `$${Number(params.value).toFixed(2)}` : '',
      valueSetter: (params) => {
        const val = params.newValue === '' || params.newValue === null ? null : parseFloat(params.newValue);
        if (params.data && val !== params.oldValue) {
          onCellChange(params.data.id, 'salePrice', val);
          return true;
        }
        return false;
      },
      cellEditor: 'agTextCellEditor',
      headerTooltip: 'Required - Right-click to bulk edit',
      suppressSizeToFit: true,
      cellClass: getMandatoryCellClass('salePrice'),
    },
    {
      headerName: 'Year*',
      field: 'year',
      width: 130,
      minWidth: 100,
      editable: true,
      valueSetter: (params) => {
        const val = params.newValue === '' || params.newValue === null ? null : parseInt(params.newValue);
        if (params.data && val !== params.oldValue) {
          onCellChange(params.data.id, 'year', val);
          return true;
        }
        return false;
      },
      cellEditor: 'agTextCellEditor',
      headerTooltip: 'Required - Right-click to bulk edit',
      suppressSizeToFit: true,
      cellClass: getMandatoryCellClass('year'),
    },
    {
      headerName: 'Category*',
      field: 'category',
      width: 165,
      minWidth: 140,
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: CATEGORY_OPTIONS },
      valueSetter: createValueSetter('category'),
      headerTooltip: 'Required - Right-click to bulk edit',
      suppressSizeToFit: true,
      cellClass: getMandatoryCellClass('category'),
    },
    {
      headerName: 'Brand*',
      field: 'brand',
      width: 150,
      minWidth: 120,
      editable: true,
      valueSetter: createValueSetter('brand'),
      headerTooltip: 'Required - Right-click to bulk edit',
      suppressSizeToFit: true,
      cellClass: getMandatoryCellClass('brand'),
    },
    {
      headerName: 'Set*',
      field: 'setName',
      width: 150,
      minWidth: 120,
      editable: true,
      valueSetter: createValueSetter('setName'),
      headerTooltip: 'Required - Right-click to bulk edit',
      suppressSizeToFit: true,
      cellClass: getMandatoryCellClass('setName'),
    },
    {
      headerName: 'Name*',
      field: 'name',
      width: 180,
      minWidth: 150,
      editable: true,
      valueSetter: createValueSetter('name'),
      headerTooltip: 'Required - Right-click to bulk edit',
      cellClass: getMandatoryCellClass('name'),
    },
    {
      headerName: 'Card #*',
      field: 'cardNumber',
      width: 145,
      minWidth: 120,
      editable: true,
      valueSetter: createValueSetter('cardNumber'),
      headerTooltip: 'Required - Right-click to bulk edit',
      suppressSizeToFit: true,
      cellClass: getMandatoryCellClass('cardNumber'),
    },
    {
      headerName: 'Subset/Parallel*',
      field: 'subsetParallel',
      width: 210,
      minWidth: 180,
      editable: true,
      valueSetter: createValueSetter('subsetParallel'),
      headerTooltip: 'Required - Right-click to bulk edit',
      suppressSizeToFit: true,
      cellClass: getMandatoryCellClass('subsetParallel'),
    },
    {
      headerName: 'Attributes',
      field: 'attributes',
      width: 175,
      minWidth: 150,
      editable: true,
      valueSetter: createValueSetter('attributes'),
      headerTooltip: 'Right-click to bulk edit',
      suppressSizeToFit: true,
    },
    {
      headerName: 'Team',
      field: 'team',
      width: 150,
      minWidth: 120,
      editable: true,
      valueSetter: createValueSetter('team'),
      headerTooltip: 'Right-click to bulk edit',
      suppressSizeToFit: true,
    },
    // Additional columns after the main ones
    {
      headerName: 'Variation',
      field: 'variation',
      width: 160,
      minWidth: 140,
      editable: true,
      valueSetter: createValueSetter('variation'),
      headerTooltip: 'Right-click to bulk edit',
      suppressSizeToFit: true,
    },
    // Condition-related columns
    {
      headerName: 'Condition Type*',
      field: 'conditionType',
      width: 350,
      minWidth: 300,
      editable: true,
      singleClickEdit: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: CONDITION_TYPE_OPTIONS },
      valueSetter: (params) => {
        if (params.data && params.newValue !== params.oldValue) {
          onCellChange(params.data.id, 'conditionType', params.newValue);
          return true;
        }
        return false;
      },
      headerTooltip: 'Required - Right-click to bulk edit',
      suppressSizeToFit: true,
      cellClass: getMandatoryCellClass('conditionType'),
    },
    {
      headerName: 'Card Condition*',
      field: 'condition',
      width: 400,
      minWidth: 350,
      editable: false,
      cellRenderer: (params: ICellRendererParams<CardItemWithImages>) => {
        const card = params.data;
        if (!card) return null;
        const isGraded = isCardGraded(card);
        
        if (isGraded) {
          return <span style={{ color: '#71717a', fontStyle: 'italic' }}>N/A (graded)</span>;
        }
        
        const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
          onCellChange(card.id, 'condition', e.target.value);
        };
        
        return (
          <select
            value={params.value || ''}
            onChange={handleChange}
            onClick={(e) => e.stopPropagation()}
            style={{ 
              backgroundColor: 'transparent',
              border: 'none',
              color: '#fafafa',
              cursor: 'pointer',
              outline: 'none',
              width: '100%',
            }}
          >
            <option value="" style={{ backgroundColor: '#27272a', color: '#a1a1aa' }}>Select condition...</option>
            {CONDITION_OPTIONS.map(opt => (
              <option key={opt} value={opt} style={{ backgroundColor: '#27272a', color: '#fafafa' }}>
                {opt}
              </option>
            ))}
          </select>
        );
      },
      headerTooltip: 'Required when ungraded - Right-click to bulk edit',
      suppressSizeToFit: true,
      cellClass: getMandatoryCellClass('condition'),
    },
    {
      headerName: 'Professional Grader',
      field: 'grader',
      width: 350,
      minWidth: 300,
      editable: false,
      cellRenderer: (params: ICellRendererParams<CardItemWithImages>) => {
        const card = params.data;
        if (!card) return null;
        const isGraded = isCardGraded(card);
        
        if (!isGraded) {
          return null;
        }
        
        const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
          onCellChange(card.id, 'grader', e.target.value);
        };
        
        return (
          <select
            value={params.value || ''}
            onChange={handleChange}
            onClick={(e) => e.stopPropagation()}
            style={{ 
              backgroundColor: isMandatoryFieldEmpty('grader', params.value, card) ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
              border: 'none',
              color: '#fafafa',
              cursor: 'pointer',
              outline: 'none',
              width: '100%',
            }}
          >
            <option value="" style={{ backgroundColor: '#27272a', color: '#a1a1aa' }}>Select grader...</option>
            {GRADER_OPTIONS.map(opt => (
              <option key={opt} value={opt} style={{ backgroundColor: '#27272a', color: '#fafafa' }}>
                {opt}
              </option>
            ))}
          </select>
        );
      },
      headerTooltip: 'Required when Graded - Right-click to bulk edit',
      suppressSizeToFit: true,
    },
    {
      headerName: 'Grade',
      field: 'grade',
      width: 150,
      minWidth: 120,
      editable: false,
      cellRenderer: (params: ICellRendererParams<CardItemWithImages>) => {
        const card = params.data;
        if (!card) return null;
        const isGraded = isCardGraded(card);
        
        if (!isGraded) {
          return null;
        }
        
        const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
          onCellChange(card.id, 'grade', e.target.value);
        };
        
        return (
          <select
            value={(params.value as string) || ''}
            onChange={handleChange}
            onClick={(e) => e.stopPropagation()}
            style={{ 
              backgroundColor: isMandatoryFieldEmpty('grade', params.value, card) ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
              border: 'none',
              color: '#fafafa',
              cursor: 'pointer',
              outline: 'none',
              width: '100%',
            }}
          >
            <option value="" style={{ backgroundColor: '#27272a', color: '#a1a1aa' }}>Select...</option>
            {GRADE_OPTIONS.map(opt => (
              <option key={opt} value={opt} style={{ backgroundColor: '#27272a', color: '#fafafa' }}>
                {opt}
              </option>
            ))}
          </select>
        );
      },
      headerTooltip: 'Required when Graded - Right-click to bulk edit',
      suppressSizeToFit: true,
    },
    {
      headerName: 'Certification Number',
      field: 'certNo',
      width: 240,
      minWidth: 200,
      editable: false,
      cellRenderer: (params: ICellRendererParams<CardItemWithImages>) => {
        const card = params.data;
        if (!card) return null;
        const isGraded = isCardGraded(card);
        
        if (!isGraded) {
          return null;
        }
        
        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
          onCellChange(card.id, 'certNo', e.target.value);
        };
        
        const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
          onCellChange(card.id, 'certNo', e.target.value);
        };
        
        return (
          <input
            type="text"
            defaultValue={params.value || ''}
            onChange={handleChange}
            onBlur={handleBlur}
            onClick={(e) => e.stopPropagation()}
            placeholder="Enter cert #..."
            style={{ 
              backgroundColor: 'transparent',
              border: 'none',
              color: '#fafafa',
              outline: 'none',
              width: '100%',
            }}
          />
        );
      },
      headerTooltip: 'Recommended when graded - Right-click to bulk edit',
      suppressSizeToFit: true,
    },
    {
      headerName: 'Item Description',
      field: 'description',
      width: 450,
      minWidth: 300,
      editable: true,
      cellEditor: 'agLargeTextCellEditor',
      cellEditorParams: {
        maxLength: 5000,
        rows: 5,
        cols: 50,
      },
      headerTooltip: 'Custom description for eBay listing - Right-click to bulk edit',
      suppressSizeToFit: true,
    },
  ], [onCellChange]);

  const defaultColDef = useMemo<ColDef>(() => ({
    sortable: true,
    resizable: true,
    filter: true,
    suppressAutoSize: true, // Prevent auto-sizing from resetting widths
  }), []);

  const onGridReady = useCallback((event: GridReadyEvent) => {
    // Don't auto-size, let columns use their defined widths
  }, []);

  // Tab navigation: move down the column instead of across the row
  const tabToNextCell = useCallback((params: TabToNextCellParams) => {
    const { backwards, nextCellPosition, previousCellPosition } = params;
    
    if (!nextCellPosition) return null;
    
    const currentColumn = previousCellPosition?.column;
    const currentRowIndex = previousCellPosition?.rowIndex ?? 0;
    const api = params.api;
    const rowCount = api.getDisplayedRowCount();
    
    if (!currentColumn) return nextCellPosition;
    
    // Calculate next row index (down for Tab, up for Shift+Tab)
    let nextRowIndex: number;
    if (backwards) {
      // Shift+Tab: move up
      nextRowIndex = currentRowIndex - 1;
      if (nextRowIndex < 0) {
        nextRowIndex = rowCount - 1; // Wrap to last row
      }
    } else {
      // Tab: move down
      nextRowIndex = currentRowIndex + 1;
      if (nextRowIndex >= rowCount) {
        nextRowIndex = 0; // Wrap to first row
      }
    }
    
    return {
      rowIndex: nextRowIndex,
      column: currentColumn, // Stay in the same column
      rowPinned: null, // Required by CellPosition type
    };
  }, []);

  // Quick filter when search text changes
  useMemo(() => {
    if (gridRef.current?.api) {
      gridRef.current.api.setGridOption('quickFilterText', searchText);
    }
  }, [searchText]);

  return (
    <>
      <div 
        className="ag-theme-alpine-dark h-full w-full"
        onContextMenu={onColumnHeaderContextMenu}
      >
        <AgGridReact
          ref={gridRef}
          rowData={cards}
          columnDefs={columns}
          defaultColDef={defaultColDef}
          context={gridContext}
          onGridReady={onGridReady}
          onCellClicked={onCellClicked}
          onCellFocused={onCellFocused}
          onCellContextMenu={onCellContextMenu}
          onCellValueChanged={onCellValueChanged}
          getRowId={(params) => params.data.id}
          animateRows={true}
          rowSelection="multiple"
          suppressRowClickSelection={true}
          stopEditingWhenCellsLoseFocus={true}
          enterNavigatesVertically={true}
          enterNavigatesVerticallyAfterEdit={true}
          singleClickEdit={false}
          quickFilterText={searchText}
          tooltipShowDelay={500}
          rowClassRules={rowClassRules}
          suppressContextMenu={true}
          tabToNextCell={tabToNextCell}
          maintainColumnOrder={true}
          suppressColumnMoveAnimation={true}
        />
      </div>
      
      <BulkEditModal
        isOpen={showBulkEdit}
        column={bulkEditColumn}
        itemCount={cards.length}
        onClose={() => setShowBulkEdit(false)}
        onApply={handleBulkEditApply}
      />

      {/* Image Preview Popup */}
      {previewCard && previewCard.images.length > 0 && (
        <ImagePreviewPopup
          images={previewCard.images}
          cardTitle={previewCard.title || previewCard.name || `Card #${previewCard.cardNumber || previewCard.id.slice(0, 8)}`}
          onClose={() => setPreviewCard(null)}
        />
      )}

      {/* Row Context Menu */}
      {contextMenu?.show && (
        <div
          className="fixed z-50 bg-surface-800 border border-surface-600 rounded-lg shadow-xl overflow-hidden animate-fade-in"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            minWidth: '180px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-surface-700 bg-surface-900/50">
            <span className="text-xs text-surface-400 truncate block max-w-[200px]">
              {contextMenu.cardTitle}
            </span>
          </div>
          <button
            onClick={handleCloneCard}
            className="w-full px-3 py-2.5 text-left text-sm hover:bg-surface-700 flex items-center gap-3 transition-colors"
          >
            <svg className="w-4 h-4 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span>Clone Row</span>
          </button>
          <button
            onClick={handleDeleteCard}
            className="w-full px-3 py-2.5 text-left text-sm hover:bg-red-900/30 text-red-400 flex items-center gap-3 transition-colors border-t border-surface-700"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>Delete Row</span>
          </button>
        </div>
      )}
    </>
  );
}

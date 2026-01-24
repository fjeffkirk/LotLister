'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { LotWithCards, CardItemWithImages } from '../../../lib/types';
import ExportSettingsModal from '../../../components/ExportSettingsModal';

// Check if a card is graded (based on conditionType)
function isCardGraded(card: CardItemWithImages): boolean {
  return (card as Record<string, unknown>).conditionType === 'Graded: Professionally graded';
}

// Check if a card has all mandatory fields filled for eBay export
function isCardReadyForExport(card: CardItemWithImages): boolean {
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

// Dynamic import for AG Grid to avoid SSR issues
const CardGrid = dynamic(() => import('../../../components/CardGrid'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <div className="spinner w-8 h-8"></div>
    </div>
  ),
});

export default function LotPage() {
  const params = useParams();
  const lotId = params.lotId as string;
  const router = useRouter();
  
  const [lot, setLot] = useState<LotWithCards | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showExportSettings, setShowExportSettings] = useState(false);
  const [exportModeSettings, setExportModeSettings] = useState(false); // True when opened via eBay export
  const [exporting, setExporting] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);

  // Check if all cards are ready for eBay export
  const exportReadiness = useMemo(() => {
    if (!lot || lot.cardItems.length === 0) {
      return { ready: false, incompleteCount: 0, totalCount: 0 };
    }
    const incompleteCards = lot.cardItems.filter(card => !isCardReadyForExport(card));
    return {
      ready: incompleteCards.length === 0,
      incompleteCount: incompleteCards.length,
      totalCount: lot.cardItems.length,
    };
  }, [lot]);

  useEffect(() => {
    fetchLot();
  }, [lotId]);

  async function fetchLot() {
    try {
      const res = await fetch(`/api/lots/${lotId}`);
      const data = await res.json();
      if (data.success) {
        setLot(data.data);
      } else {
        setError(data.error || 'Failed to load lot');
      }
    } catch (err) {
      setError('Failed to load lot');
    } finally {
      setLoading(false);
    }
  }

  // Debounced save for cell changes
  const saveChanges = useCallback(async (changes: Map<string, Record<string, unknown>>) => {
    if (changes.size === 0) return;
    
    const updates = Array.from(changes.entries()).map(([id, data]) => ({
      id,
      data,
    }));

    try {
      const res = await fetch(`/api/lots/${lotId}/cards`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      const data = await res.json();
      if (data.success) {
        setLot((prev) => prev ? { ...prev, cardItems: data.data } : null);
      }
    } catch (err) {
      console.error('Failed to save changes:', err);
    }
  }, [lotId]);

  const handleCellChange = useCallback((cardId: string, field: string, value: unknown) => {
    // Update local state immediately for responsive UI
    setLot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cardItems: prev.cardItems.map((card) =>
          card.id === cardId ? { ...card, [field]: value } : card
        ),
      };
    });

    // Queue the change
    setPendingChanges((prev) => {
      const newChanges = new Map(prev);
      const existing = newChanges.get(cardId) || {};
      newChanges.set(cardId, { ...existing, [field]: value });
      return newChanges;
    });

    // Debounce save
    if (saveTimeout) clearTimeout(saveTimeout);
    const timeout = setTimeout(() => {
      setPendingChanges((current) => {
        saveChanges(current);
        return new Map();
      });
    }, 500);
    setSaveTimeout(timeout);
  }, [saveChanges, saveTimeout]);

  // Handle bulk edit for all cards
  const handleBulkEdit = useCallback(async (field: string, value: unknown) => {
    if (!lot) return;
    
    // Update local state immediately
    setLot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cardItems: prev.cardItems.map((card) => ({
          ...card,
          [field]: value,
        })),
      };
    });
    
    // Create updates for all cards
    const updates = lot.cardItems.map((card) => ({
      id: card.id,
      data: { [field]: value },
    }));
    
    // Save to database
    try {
      const res = await fetch(`/api/lots/${lotId}/cards`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      const data = await res.json();
      if (data.success) {
        setLot((prev) => prev ? { ...prev, cardItems: data.data } : null);
      }
    } catch (err) {
      console.error('Failed to bulk edit:', err);
      setError('Failed to save bulk edit');
    }
  }, [lot, lotId]);

  // Handle clone card
  const handleCloneCard = useCallback(async (cardId: string) => {
    try {
      const res = await fetch(`/api/lots/${lotId}/cards/${cardId}/clone`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        // Refetch lot to get updated cards list
        fetchLot();
      } else {
        setError(data.error || 'Failed to clone card');
      }
    } catch (err) {
      console.error('Failed to clone card:', err);
      setError('Failed to clone card');
    }
  }, [lotId]);

  // Handle delete card
  const handleDeleteCard = useCallback(async (cardId: string) => {
    try {
      const res = await fetch(`/api/lots/${lotId}/cards/${cardId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        // Update local state to remove the card
        setLot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            cardItems: prev.cardItems.filter((card) => card.id !== cardId),
          };
        });
      } else {
        setError(data.error || 'Failed to delete card');
      }
    } catch (err) {
      console.error('Failed to delete card:', err);
      setError('Failed to delete card');
    }
  }, [lotId]);

  function handleExportClick(type: 'raw' | 'ebay') {
    setShowExportMenu(false);
    
    if (type === 'ebay') {
      // Open settings modal in export mode for eBay
      setExportModeSettings(true);
      setShowExportSettings(true);
    } else {
      // Raw export directly
      performExport('raw');
    }
  }

  async function toggleLotComplete() {
    if (!lot) return;
    
    try {
      const res = await fetch(`/api/lots/${lotId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !lot.completed }),
      });
      const data = await res.json();
      
      if (data.success) {
        setLot(prev => prev ? { ...prev, completed: !prev.completed } : null);
      } else {
        setError(data.error || 'Failed to update lot');
      }
    } catch (err) {
      setError('Failed to update lot');
    }
  }
  
  async function performExport(type: 'raw' | 'ebay') {
    setExporting(true);
    
    try {
      // Get client's timezone offset in minutes (negative for ahead of UTC)
      const timezoneOffset = new Date().getTimezoneOffset();
      
      const endpoint = type === 'raw' 
        ? `/api/lots/${lotId}/export/raw`
        : `/api/lots/${lotId}/export/ebay?tzOffset=${timezoneOffset}`;
      
      const res = await fetch(endpoint);
      
      if (!res.ok) {
        throw new Error('Export failed');
      }
      
      // Get filename from Content-Disposition header
      const contentDisposition = res.headers.get('Content-Disposition');
      let filename = `export_${type}.csv`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) filename = match[1];
      }
      
      // Download the file
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      // Close the modal after successful export
      if (type === 'ebay') {
        setShowExportSettings(false);
        setExportModeSettings(false);
      }
    } catch (err) {
      setError('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="spinner w-8 h-8"></div>
      </div>
    );
  }

  if (error || !lot) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error || 'Lot not found'}</p>
          <Link href="/lots" className="btn btn-secondary">
            Back to Lots
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-950 flex flex-col">
      {/* Header */}
      <header className="border-b border-surface-800 bg-surface-900/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="px-3 sm:px-4 py-2 sm:py-3">
          {/* Main header row */}
          <div className="flex items-center justify-between gap-2">
            {/* Left: Back + Lot info */}
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
              <Link
                href="/lots"
                className="btn-ghost p-1.5 sm:p-2 rounded-lg flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div className="min-w-0">
                <h1 className="font-semibold text-base sm:text-lg truncate">{lot.name}</h1>
                <p className="text-xs sm:text-sm text-surface-400">
                  {lot.cardItems.length} {lot.cardItems.length === 1 ? 'card' : 'cards'}
                </p>
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
              {/* Search - hidden on mobile, shown on sm+ */}
              <div className="hidden sm:flex relative items-center">
                <svg className="w-4 h-4 absolute left-3 text-surface-400 pointer-events-none z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  style={{ paddingLeft: '2.5rem' }}
                  className="pr-4 py-2 w-40 lg:w-56 text-sm bg-surface-800 border border-surface-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>

              {/* Import */}
              <Link
                href={`/lots/${lotId}/import`}
                className="btn btn-secondary text-sm py-1.5 px-2 sm:px-3"
                title="Import"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span className="hidden md:inline">Import</span>
              </Link>

              {/* Export dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  disabled={exporting || lot.cardItems.length === 0}
                  className="btn btn-secondary text-sm py-1.5 px-2 sm:px-3"
                  title="Export"
                >
                  {exporting ? (
                    <div className="spinner w-4 h-4"></div>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      <span className="hidden md:inline">Export</span>
                      <svg className="w-3 h-3 hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </>
                  )}
                </button>
                {showExportMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowExportMenu(false)}
                    />
                    <div className="absolute right-0 mt-2 w-72 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-20 overflow-hidden animate-slide-up">
                      <div className="relative group">
                        <button
                          onClick={() => exportReadiness.ready && handleExportClick('ebay')}
                          disabled={!exportReadiness.ready}
                          className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 ${
                            exportReadiness.ready 
                              ? 'hover:bg-surface-700 cursor-pointer' 
                              : 'opacity-50 cursor-not-allowed'
                          }`}
                        >
                          <svg className={`w-5 h-5 ${exportReadiness.ready ? 'text-primary-400' : 'text-surface-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <div className="flex-1">
                            <div className={`font-medium ${!exportReadiness.ready ? 'text-surface-400' : ''}`}>eBay File Exchange CSV</div>
                            <div className="text-xs text-surface-400">
                              {exportReadiness.ready 
                                ? 'For bulk upload to eBay' 
                                : `${exportReadiness.incompleteCount} of ${exportReadiness.totalCount} cards missing required fields`
                              }
                            </div>
                          </div>
                          {!exportReadiness.ready && (
                            <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          )}
                        </button>
                        {!exportReadiness.ready && (
                          <div className="px-4 py-2 bg-surface-900/80 border-t border-surface-700 text-xs text-amber-400">
                            <span className="flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Fill out all required fields (marked with *) to export
                            </span>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleExportClick('raw')}
                        className="w-full px-4 py-3 text-left text-sm hover:bg-surface-700 flex items-center gap-3 border-t border-surface-700"
                      >
                        <svg className="w-5 h-5 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <div>
                          <div className="font-medium">Raw CSV</div>
                          <div className="text-xs text-surface-400">All fields as-is</div>
                        </div>
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Export Settings */}
              <button
                onClick={() => setShowExportSettings(true)}
                className="btn btn-ghost text-sm py-1.5 px-2 sm:px-3"
                title="Settings"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="hidden lg:inline">Settings</span>
              </button>

              {/* Mark as Completed */}
              <button
                onClick={toggleLotComplete}
                className={`btn text-sm py-1.5 px-2 sm:px-3 ${lot?.completed ? 'btn-secondary' : 'btn-ghost border border-green-600 text-green-400 hover:bg-green-600/20'}`}
                title={lot?.completed ? 'Mark as In Progress' : 'Mark as Completed'}
              >
                {lot?.completed ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="hidden lg:inline">Mark In Progress</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="hidden lg:inline">Mark Completed</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Mobile search row - only on small screens */}
          <div className="sm:hidden mt-2 pt-2 border-t border-surface-800/50">
            <div className="relative flex items-center">
              <svg className="w-4 h-4 absolute left-3 text-surface-400 pointer-events-none z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search cards..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                style={{ paddingLeft: '2.5rem' }}
                className="w-full pr-4 py-2 text-sm bg-surface-800 border border-surface-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Grid */}
      <main className="flex-1 p-4">
        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
            {error}
            <button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-red-300">
              ✕
            </button>
          </div>
        )}

        {lot.cardItems.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center py-20">
              <div className="w-20 h-20 mx-auto mb-6 bg-surface-800 rounded-full flex items-center justify-center">
                <svg className="w-10 h-10 text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-surface-200 mb-2">No cards yet</h2>
              <p className="text-surface-400 mb-6">Import photos to create card rows</p>
              <Link
                href={`/lots/${lotId}/import`}
                className="btn btn-primary"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import Photos
              </Link>
            </div>
          </div>
        ) : (
          <div className="h-[calc(100vh-120px)] panel">
            <CardGrid
              cards={lot.cardItems}
              onCellChange={handleCellChange}
              onBulkEdit={handleBulkEdit}
              onCloneCard={handleCloneCard}
              onDeleteCard={handleDeleteCard}
              searchText={searchText}
            />
          </div>
        )}
      </main>

      {/* Export Settings Modal */}
      <ExportSettingsModal
        lotId={lotId}
        isOpen={showExportSettings}
        onClose={() => {
          setShowExportSettings(false);
          setExportModeSettings(false);
        }}
        onExport={exportModeSettings ? () => performExport('ebay') : undefined}
        isExporting={exporting}
      />
    </div>
  );
}

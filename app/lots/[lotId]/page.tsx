'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { LotWithCards, CardItemWithImages } from '../../../lib/types';
import { isCardComplete as isCardReadyForExport } from '../../../lib/card-completeness';
import { parseCardDefaults, CardDefaults, COMPLETED_DELETE_DAYS } from '../../../lib/card-fields';
import ExportSettingsModal from '../../../components/ExportSettingsModal';
import PSAImportModal from '../../../components/PSAImportModal';
import LotDefaultsModal from '../../../components/LotDefaultsModal';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

const SAVE_DEBOUNCE_MS = 600;
const SAVE_RETRY_MS = 4000;
const DELETE_UNDO_MS = 6000;

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
  const [settingsPurpose, setSettingsPurpose] = useState<'csv' | 'list'>('csv');
  const [showPSAImport, setShowPSAImport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [listing, setListing] = useState(false);
  const [ebayReady, setEbayReady] = useState<boolean | null>(null);
  const [listResult, setListResult] = useState<{
    listedCount: number;
    failedCount: number;
    skippedNotReady: number;
    skippedAlreadyListed: number;
    remainingReady: number;
    results: { cardId: string; title: string; success: boolean; listingUrl?: string; error?: string }[];
  } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showDefaults, setShowDefaults] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});

  // Edits waiting to be sent, merged per card. Refs keep handleCellChange stable, so the grid never rebuilds its columns.
  const pendingRef = useRef(new Map<string, Record<string, unknown>>());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const saveFailedRef = useRef(false);
  const pendingDeletesRef = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; card: CardItemWithImages; index: number; commit: () => Promise<void> }>()
  );
  const toastIdRef = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback((message: string, action?: { label: string; onAction: () => void }, durationMs = 4000) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev.slice(-2), { id, message, actionLabel: action?.label, onAction: action?.onAction }]);
    setTimeout(() => dismissToast(id), durationMs);
    return id;
  }, [dismissToast]);

  const lotRef = useRef<LotWithCards | null>(null);
  lotRef.current = lot;

  const cardDefaults = useMemo<CardDefaults>(() => parseCardDefaults(lot?.cardDefaults), [lot?.cardDefaults]);

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

  const listableCount = useMemo(() => {
    if (!lot) return 0;
    return lot.cardItems.filter((card) => isCardReadyForExport(card) && !card.ebayItemId).length;
  }, [lot]);

  useEffect(() => {
    fetchLot();
    fetch('/api/suggestions')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setSuggestions(data.data);
      })
      .catch(() => undefined);
    fetch('/api/ebay/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setEbayReady(Boolean(data.data.configured && data.data.connected));
        }
      })
      .catch(() => setEbayReady(false));
  }, [lotId]);

  async function fetchLot() {
    try {
      const res = await fetch(`/api/lots/${lotId}`);
      const data = await res.json();
      if (data.success) {
        // Unsaved edits and not-yet-committed deletes win over what the server just returned
        const fetched = data.data as LotWithCards;
        setLot({
          ...fetched,
          cardItems: fetched.cardItems
            .filter((card) => !pendingDeletesRef.current.has(card.id))
            .map((card) => {
              const pending = pendingRef.current.get(card.id);
              return pending ? { ...card, ...pending } : card;
            }),
        });
      } else {
        setError(data.error || 'Failed to load lot');
      }
    } catch (err) {
      setError('Failed to load lot');
    } finally {
      setLoading(false);
    }
  }

  // Local state is the source of truth; the server response is never written back over it, so edits
  // made while a save is in flight can't be reverted.
  const flushSaves = useCallback(async (options: { keepalive?: boolean } = {}) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (pendingRef.current.size === 0) return;
    if (inFlightRef.current && !options.keepalive) return; // the in-flight save reschedules when it finishes

    const batch = pendingRef.current;
    pendingRef.current = new Map();
    inFlightRef.current = true;
    setSaveState('saving');

    let retryable = false;
    try {
      const res = await fetch(`/api/lots/${lotId}/cards`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: Array.from(batch, ([id, data]) => ({ id, data })) }),
        keepalive: options.keepalive,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        retryable = res.status >= 500 || res.status === 0;
        throw new Error(data.error || `Save failed (${res.status})`);
      }
      saveFailedRef.current = false;
      setSaveError(null);
      setSaveState(pendingRef.current.size > 0 ? 'saving' : 'saved');
    } catch (err) {
      saveFailedRef.current = true;
      const message = err instanceof Error ? err.message : 'Save failed';
      if (retryable || err instanceof TypeError) {
        // Put the batch back underneath any newer edits and try again shortly
        for (const [id, data] of batch) {
          pendingRef.current.set(id, { ...data, ...(pendingRef.current.get(id) ?? {}) });
        }
        setSaveError('Offline or server error. Retrying…');
        saveTimerRef.current = setTimeout(() => flushSavesRef.current(), SAVE_RETRY_MS);
      } else {
        setSaveError(`Couldn't save: ${message}`);
      }
      setSaveState('error');
      return;
    } finally {
      inFlightRef.current = false;
    }
    if (pendingRef.current.size > 0) {
      saveTimerRef.current = setTimeout(() => flushSavesRef.current(), SAVE_DEBOUNCE_MS);
    }
  }, [lotId]);

  const flushSavesRef = useRef(flushSaves);
  flushSavesRef.current = flushSaves;

  /** Waits until every queued edit and delete has reached the server (before clone, export, or listing). */
  const saveAll = useCallback(async () => {
    await Promise.all(
      Array.from(pendingDeletesRef.current.values(), (pending) => {
        clearTimeout(pending.timer);
        return pending.commit();
      })
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      if (inFlightRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      if (pendingRef.current.size === 0) break;
      await flushSavesRef.current();
      if (saveFailedRef.current) {
        throw new Error('Some changes have not saved yet. Check your connection and try again.');
      }
    }
  }, []);

  const queueSave = useCallback((cardId: string, data: Record<string, unknown>) => {
    pendingRef.current.set(cardId, { ...(pendingRef.current.get(cardId) ?? {}), ...data });
    setSaveState('saving');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => flushSavesRef.current(), SAVE_DEBOUNCE_MS);
  }, []);

  const handleCellChange = useCallback((cardId: string, field: string, value: unknown) => {
    setLot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cardItems: prev.cardItems.map((card) =>
          card.id === cardId ? { ...card, [field]: value } : card
        ),
      };
    });
    queueSave(cardId, { [field]: value });
  }, [queueSave]);

  // Multi-card edits from bulk edit, fill down, and paste
  const handleCardsChange = useCallback((updates: { id: string; data: Record<string, unknown> }[]) => {
    if (updates.length === 0) return;
    const byId = new Map<string, Record<string, unknown>>();
    for (const { id, data } of updates) byId.set(id, { ...(byId.get(id) ?? {}), ...data });
    setLot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cardItems: prev.cardItems.map((card) => {
          const data = byId.get(card.id);
          return data ? { ...card, ...data } : card;
        }),
      };
    });
    for (const [id, data] of byId) queueSave(id, data);
  }, [queueSave]);

  // Send pending edits and deletes if the tab is hidden or closed, and warn if a save is still in flight
  useEffect(() => {
    const flushDeletes = () => {
      for (const [cardId, pending] of pendingDeletesRef.current) {
        clearTimeout(pending.timer);
        fetch(`/api/lots/${lotId}/cards/${cardId}`, { method: 'DELETE', keepalive: true }).catch(() => undefined);
      }
      pendingDeletesRef.current.clear();
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushSavesRef.current({ keepalive: true });
    };
    const onPageHide = () => {
      flushSavesRef.current({ keepalive: true });
      flushDeletes();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (pendingRef.current.size > 0 || inFlightRef.current) {
        flushSavesRef.current({ keepalive: true });
        event.preventDefault();
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      onPageHide();
    };
  }, [lotId]);

  // Handle clone card
  const handleCloneCard = useCallback(async (cardId: string) => {
    try {
      await saveAll();
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
      setError(err instanceof Error && err.message.startsWith('Some changes') ? err.message : 'Failed to clone card');
    }
  }, [lotId, saveAll]);

  // Delete is delayed so it can be undone; the request goes out when the undo window closes or the page is left
  const handleDeleteCard = useCallback((cardId: string) => {
    const cards = lotRef.current?.cardItems ?? [];
    const index = cards.findIndex((card) => card.id === cardId);
    if (index === -1 || pendingDeletesRef.current.has(cardId)) return;
    const snapshot = { card: cards[index], index };
    setLot((prev) => (prev ? { ...prev, cardItems: prev.cardItems.filter((card) => card.id !== cardId) } : prev));

    const commit = async () => {
      pendingDeletesRef.current.delete(cardId);
      pendingRef.current.delete(cardId);
      try {
        const res = await fetch(`/api/lots/${lotId}/cards/${cardId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
      } catch {
        setError('Failed to delete card. Reloading the lot.');
        fetchLot();
      }
    };
    const timer = setTimeout(commit, DELETE_UNDO_MS);
    pendingDeletesRef.current.set(cardId, { timer, commit, ...snapshot });

    const toastId = notify(
      `Deleted "${snapshot.card.title || snapshot.card.name || 'card'}"`,
      {
        label: 'Undo',
        onAction: () => {
          const pending = pendingDeletesRef.current.get(cardId);
          if (!pending) return;
          clearTimeout(pending.timer);
          pendingDeletesRef.current.delete(cardId);
          setLot((prev) => {
            if (!prev) return prev;
            const cardItems = [...prev.cardItems];
            cardItems.splice(Math.min(pending.index, cardItems.length), 0, pending.card);
            return { ...prev, cardItems };
          });
          dismissToast(toastId);
        },
      },
      DELETE_UNDO_MS
    );
  }, [lotId, notify, dismissToast]);

  function handleListClick() {
    setShowExportMenu(false);
    if (!ebayReady) {
      router.push('/settings');
      return;
    }
    setSettingsPurpose('list');
    setExportModeSettings(true);
    setShowExportSettings(true);
  }

  function handleExportClick(type: 'raw' | 'ebay') {
    setShowExportMenu(false);
    
    if (type === 'ebay') {
      // Open settings modal in export mode for eBay
      setSettingsPurpose('csv');
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
      await saveAll();
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
      setError(err instanceof Error && err.message.startsWith('Some changes') ? err.message : 'Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  async function performList() {
    setListing(true);
    setError(null);
    try {
      await saveAll();
      const timezoneOffset = new Date().getTimezoneOffset();
      const res = await fetch(`/api/lots/${lotId}/list-ebay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tzOffset: timezoneOffset }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Listing failed');
      }
      setShowExportSettings(false);
      setExportModeSettings(false);
      setListResult(data.data);
      fetchLot();
    } catch (err) {
      setShowExportSettings(false);
      setExportModeSettings(false);
      setError(err instanceof Error ? err.message : 'Listing failed. Please try again.');
    } finally {
      setListing(false);
    }
  }

  async function saveCardDefaults(defaults: Record<string, unknown>, fillExisting: boolean) {
    await saveAll();
    const res = await fetch(`/api/lots/${lotId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardDefaults: defaults, fillExisting }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to save defaults');
    setLot(data.data);
    setShowDefaults(false);
    notify(fillExisting ? 'Defaults saved and applied to empty fields' : 'Defaults saved for new cards');
  }

  const saveIndicator =
    saveState === 'error' ? (
      <button
        onClick={() => flushSavesRef.current()}
        className="text-xs text-red-300 hover:text-red-200 underline decoration-dotted"
        title={saveError ?? undefined}
      >
        {saveError?.startsWith("Couldn't") ? saveError : 'Not saved — retry'}
      </button>
    ) : saveState === 'saving' ? (
      <span className="text-xs text-surface-400">Saving…</span>
    ) : saveState === 'saved' ? (
      <span className="text-xs text-surface-500">All changes saved</span>
    ) : null;

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="spinner w-8 h-8"></div>
      </div>
    );
  }

  if (!lot) {
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
                <p className="text-xs sm:text-sm text-surface-400 flex items-center gap-2">
                  <span>
                    {lot.cardItems.length} {lot.cardItems.length === 1 ? 'card' : 'cards'}
                  </span>
                  {saveIndicator && <span className="text-surface-600">·</span>}
                  {saveIndicator}
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
                title="Import Photos"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span className="hidden md:inline">Import</span>
              </Link>

              {/* PSA Import */}
              <button
                onClick={() => setShowPSAImport(true)}
                className="btn btn-secondary text-sm py-1.5 px-2 sm:px-3 border-blue-600/50 text-blue-400 hover:bg-blue-600/20"
                title="Import from PSA"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span className="hidden md:inline">PSA</span>
              </button>

              {/* Lot defaults */}
              <button
                onClick={() => setShowDefaults(true)}
                className="btn btn-secondary text-sm py-1.5 px-2 sm:px-3"
                title="Values every card in this lot starts with"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h7" />
                </svg>
                <span className="hidden md:inline">Defaults</span>
              </button>

              {/* Export dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  disabled={exporting || listing || lot.cardItems.length === 0}
                  className="btn btn-secondary text-sm py-1.5 px-2 sm:px-3"
                  title="Export"
                >
                  {exporting || listing ? (
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
                      <button
                        onClick={handleListClick}
                        disabled={ebayReady === true && listableCount === 0}
                        className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 border-b border-surface-700 ${
                          ebayReady === true && listableCount === 0
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:bg-surface-700'
                        }`}
                      >
                        <svg className="w-5 h-5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h10M7 12h10M7 17h6" />
                        </svg>
                        <div className="flex-1">
                          <div className="font-medium">List on eBay</div>
                          <div className="text-xs text-surface-400">
                            {ebayReady
                              ? listableCount > 0
                                ? `Publish ${listableCount} ready ${listableCount === 1 ? 'card' : 'cards'}`
                                : 'No ready cards left to list'
                              : 'eBay is not configured on the server'}
                          </div>
                        </div>
                      </button>
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
                title={
                  lot?.completed
                    ? 'Mark as In Progress'
                    : `Mark as Completed. Completed lots are deleted automatically after ${COMPLETED_DELETE_DAYS} days.`
                }
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
              <p className="text-surface-400 mb-6">Import photos or pull data from PSA</p>
              <div className="flex items-center gap-3 justify-center">
                <Link
                  href={`/lots/${lotId}/import`}
                  className="btn btn-primary"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Import Photos
                </Link>
                <button
                  onClick={() => setShowPSAImport(true)}
                  className="btn btn-secondary border-blue-600 text-blue-400 hover:bg-blue-600/20"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Import from PSA
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-[calc(100vh-120px)] panel flex flex-col">
            <CardGrid
              cards={lot.cardItems}
              onCellChange={handleCellChange}
              onCardsChange={handleCardsChange}
              onCloneCard={handleCloneCard}
              onDeleteCard={handleDeleteCard}
              searchText={searchText}
              suggestions={suggestions}
              notify={notify}
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
        purpose={settingsPurpose}
        onExport={
          exportModeSettings
            ? settingsPurpose === 'list'
              ? performList
              : () => performExport('ebay')
            : undefined
        }
        isExporting={exporting || listing}
      />

      {listResult && (
        <div className="modal-overlay animate-fade-in" onClick={() => setListResult(null)}>
          <div
            className="modal-content w-full max-w-lg mx-4 sm:mx-auto animate-slide-up max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-surface-700">
              <h2 className="text-lg font-semibold">eBay listing results</h2>
              <button onClick={() => setListResult(null)} className="btn-ghost p-2 rounded-lg">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 sm:p-5 overflow-y-auto space-y-3 text-sm">
              <p className="text-surface-200">
                Listed {listResult.listedCount}. Failed {listResult.failedCount}.
                {listResult.remainingReady > 0
                  ? ` ${listResult.remainingReady} more ready ${listResult.remainingReady === 1 ? 'card is' : 'cards are'} waiting — list again to publish them.`
                  : ''}
              </p>
              {(listResult.skippedAlreadyListed > 0 || listResult.skippedNotReady > 0) && (
                <p className="text-surface-400">
                  Skipped {listResult.skippedAlreadyListed} already listed and {listResult.skippedNotReady} missing required fields.
                </p>
              )}
              <ul className="space-y-2">
                {listResult.results.map((result) => (
                  <li key={result.cardId} className="border border-surface-700 rounded-lg px-3 py-2">
                    <div className="font-medium text-surface-100">{result.title}</div>
                    {result.success && result.listingUrl ? (
                      <a href={result.listingUrl} target="_blank" rel="noreferrer" className="text-primary-400 hover:text-primary-300">
                        View on eBay
                      </a>
                    ) : (
                      <div className="text-red-300">{result.error}</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <LotDefaultsModal
        isOpen={showDefaults}
        defaults={cardDefaults}
        cardCount={lot.cardItems.length}
        onClose={() => setShowDefaults(false)}
        onSave={saveCardDefaults}
      />

      {toasts.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role="status"
              className="pointer-events-auto flex items-center gap-4 px-4 py-2.5 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-100 animate-slide-up"
            >
              <span className="max-w-[60vw] truncate">{toast.message}</span>
              {toast.actionLabel && (
                <button onClick={toast.onAction} className="font-medium text-primary-400 hover:text-primary-300">
                  {toast.actionLabel}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* PSA Import Modal */}
      <PSAImportModal
        lotId={lotId}
        isOpen={showPSAImport}
        onClose={() => setShowPSAImport(false)}
        onImportComplete={() => {
          // Refresh the lot data after import
          fetchLot();
        }}
      />
    </div>
  );
}

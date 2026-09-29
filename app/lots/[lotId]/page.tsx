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
import MobileCardList from '../../../components/MobileCardList';
import { Command, useRegisterCommands } from '../../../components/CommandPalette';
import { Dropdown } from '../../../components/ui/Dropdown';
import { Confetti } from '../../../components/ui/Confetti';
import {
  AlertIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  CloseIcon,
  ExternalIcon,
  FileIcon,
  GearIcon,
  MoreIcon,
  PlusIcon,
  RotateIcon,
  SearchIcon,
  ShieldIcon,
  SlidersIcon,
  SparklesIcon,
  TableIcon,
  TagIcon,
  UploadIcon,
} from '../../../components/ui/icons';

const MOBILE_QUERY = '(max-width: 767px)';

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}

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
  const [celebrate, setCelebrate] = useState(false);
  const isMobile = useIsMobile();
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
    if (!ebayReady) {
      router.push('/settings');
      return;
    }
    setSettingsPurpose('list');
    setExportModeSettings(true);
    setShowExportSettings(true);
  }

  function handleExportClick(type: 'raw' | 'ebay') {

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
        notify(lot.completed ? 'Moved back to in progress' : `Lot completed. It deletes automatically in ${COMPLETED_DELETE_DAYS} days.`);
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

  const readiness = useMemo(() => {
    const cards = lot?.cardItems ?? [];
    const listed = cards.filter((card) => card.ebayItemId).length;
    return { total: cards.length, listed, ready: listableCount, done: listed + listableCount };
  }, [lot, listableCount]);

  const commands = useMemo<Command[]>(() => {
    if (!lot) return [];
    const group = lot.name;
    return [
      { id: 'lot-list', label: listableCount > 0 ? `List ${listableCount} ready cards on eBay` : 'List on eBay', group, icon: <TagIcon />, disabled: ebayReady === true && listableCount === 0, run: handleListClick },
      { id: 'lot-import', label: 'Import photos', group, icon: <UploadIcon />, keywords: 'upload add cards', run: () => router.push(`/lots/${lotId}/import`) },
      { id: 'lot-psa', label: 'Import from PSA cert numbers', group, icon: <ShieldIcon />, keywords: 'add cards graded', run: () => setShowPSAImport(true) },
      { id: 'lot-defaults', label: 'Lot defaults', group, icon: <SlidersIcon />, keywords: 'template', run: () => setShowDefaults(true) },
      { id: 'lot-csv', label: 'Export eBay File Exchange CSV', group, icon: <FileIcon />, disabled: !exportReadiness.ready, run: () => handleExportClick('ebay') },
      { id: 'lot-raw', label: 'Export raw CSV', group, icon: <TableIcon />, run: () => handleExportClick('raw') },
      { id: 'lot-settings', label: 'Listing & export settings', group, icon: <GearIcon />, keywords: 'shipping returns', run: () => setShowExportSettings(true) },
      { id: 'lot-complete', label: lot.completed ? 'Mark lot in progress' : 'Mark lot completed', group, icon: <CheckCircleIcon />, run: toggleLotComplete },
    ];
  }, [lot?.name, lot?.completed, listableCount, ebayReady, exportReadiness.ready, lotId]);
  useRegisterCommands('lot', commands);

  useEffect(() => {
    if (listResult && listResult.listedCount > 0 && listResult.failedCount === 0) {
      setCelebrate(true);
      const timer = setTimeout(() => setCelebrate(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [listResult]);

  const saveIndicator =
    saveState === 'error' ? (
      <button
        onClick={() => flushSavesRef.current()}
        className="flex items-center gap-1.5 text-xs text-red-300 hover:text-red-200"
        title={saveError ?? undefined}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        {saveError?.startsWith("Couldn't") ? saveError : 'Not saved — retry'}
      </button>
    ) : saveState === 'saving' ? (
      <span className="flex items-center gap-1.5 text-xs text-surface-400">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        Saving…
      </span>
    ) : saveState === 'saved' ? (
      <span className="flex items-center gap-1.5 text-xs text-surface-500">
        <CheckIcon size={12} className="text-emerald-400" />
        Saved
      </span>
    ) : null;

  if (loading) {
    return <WorkspaceSkeleton />;
  }

  if (!lot) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="panel p-8 text-center max-w-sm">
          <AlertIcon size={28} className="mx-auto mb-3 text-red-300" />
          <p className="text-surface-200 mb-5">{error || 'Lot not found'}</p>
          <Link href="/lots" className="btn btn-secondary">
            <ChevronLeftIcon /> Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const listDisabled = exporting || listing || (ebayReady === true && listableCount === 0);
  const listTitle =
    ebayReady === false
      ? 'Connect eBay on the server first'
      : listableCount === 0
        ? 'No ready cards left to list'
        : `Publish ${listableCount} ready ${listableCount === 1 ? 'card' : 'cards'}`;

  const searchBox = (className: string) => (
    <div className={`relative items-center ${className}`}>
      <SearchIcon size={15} className="absolute left-3 text-surface-500 pointer-events-none" />
      <input
        type="search"
        placeholder="Search cards"
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        className="w-full h-9 pl-9 pr-3 py-0 text-sm"
      />
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <header className="glass sticky top-0 z-30 border-b border-white/[0.06]">
        <div className="px-3 sm:px-5 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link href="/lots" className="btn btn-ghost btn-icon flex-shrink-0" aria-label="Back to dashboard" title="Dashboard">
              <ChevronLeftIcon size={18} />
            </Link>
            <ReadinessRing done={readiness.done} total={readiness.total} />
            <div className="min-w-0">
              <h1 className="font-semibold text-[15px] sm:text-base text-white truncate leading-tight">{lot.name}</h1>
              <div className="flex items-center gap-2 text-xs text-surface-400 mt-0.5 whitespace-nowrap">
                <span className="tabular-nums">
                  {readiness.total === 0
                    ? 'No cards yet'
                    : `${readiness.done} of ${readiness.total} ready`}
                  {readiness.listed > 0 && <span className="hidden sm:inline"> · {readiness.listed} listed</span>}
                </span>
                {saveIndicator && <span className="text-surface-600">·</span>}
                {saveIndicator}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            {searchBox('hidden md:flex w-44 lg:w-64')}

            <Dropdown
              trigger={({ open, toggle }) => (
                <button onClick={toggle} className={`btn btn-secondary px-2.5 sm:px-3 ${open ? 'bg-white/[0.08]' : ''}`} aria-haspopup="menu" title="Add cards">
                  <PlusIcon size={16} />
                  <span className="hidden lg:inline">Add cards</span>
                  <ChevronDownIcon size={14} className="hidden lg:block text-surface-400" />
                </button>
              )}
            >
              {(close) => (
                <>
                  <Link href={`/lots/${lotId}/import`} onClick={close} className="menu-item">
                    <MenuIcon tone="primary"><UploadIcon /></MenuIcon>
                    <span>
                      <span className="block font-medium">Import photos</span>
                      <span className="block text-xs text-surface-400">Front and back scans become cards</span>
                    </span>
                  </Link>
                  <button onClick={() => { close(); setShowPSAImport(true); }} className="menu-item">
                    <MenuIcon tone="accent"><ShieldIcon /></MenuIcon>
                    <span>
                      <span className="block font-medium">PSA cert numbers</span>
                      <span className="block text-xs text-surface-400">Pull slab details and images from PSA</span>
                    </span>
                  </button>
                </>
              )}
            </Dropdown>

            <button onClick={() => setShowDefaults(true)} className="hidden lg:inline-flex btn btn-ghost" title="Values every card in this lot starts with">
              <SlidersIcon />
              Defaults
            </button>

            <Dropdown
              menuClassName="w-72"
              trigger={({ open, toggle }) => (
                <button
                  onClick={toggle}
                  disabled={exporting || listing}
                  className={`btn btn-ghost btn-icon ${open ? 'bg-white/[0.08] text-white' : ''}`}
                  aria-haspopup="menu"
                  title="More"
                >
                  {exporting ? <div className="spinner w-4 h-4" /> : <MoreIcon size={18} />}
                </button>
              )}
            >
              {(close) => (
                <>
                  <div className="menu-label">Export</div>
                  <button
                    onClick={() => { close(); handleExportClick('ebay'); }}
                    disabled={!exportReadiness.ready || lot.cardItems.length === 0}
                    className="menu-item"
                  >
                    <MenuIcon><FileIcon /></MenuIcon>
                    <span className="min-w-0">
                      <span className="block font-medium">eBay File Exchange CSV</span>
                      <span className={`block text-xs ${exportReadiness.ready ? 'text-surface-400' : 'text-amber-300/90'}`}>
                        {exportReadiness.ready
                          ? 'For bulk upload to eBay'
                          : `${exportReadiness.incompleteCount} of ${exportReadiness.totalCount} cards still need fields`}
                      </span>
                    </span>
                  </button>
                  <button onClick={() => { close(); handleExportClick('raw'); }} disabled={lot.cardItems.length === 0} className="menu-item">
                    <MenuIcon><TableIcon /></MenuIcon>
                    <span>
                      <span className="block font-medium">Raw CSV</span>
                      <span className="block text-xs text-surface-400">Every field as-is</span>
                    </span>
                  </button>
                  <div className="menu-divider" />
                  <button onClick={() => { close(); setShowDefaults(true); }} className="menu-item lg:hidden">
                    <MenuIcon><SlidersIcon /></MenuIcon> Lot defaults
                  </button>
                  <button onClick={() => { close(); setShowExportSettings(true); }} className="menu-item">
                    <MenuIcon><GearIcon /></MenuIcon> Listing &amp; export settings
                  </button>
                  <div className="menu-divider" />
                  <button
                    onClick={() => { close(); toggleLotComplete(); }}
                    className="menu-item"
                    title={lot.completed ? undefined : `Completed lots are deleted automatically after ${COMPLETED_DELETE_DAYS} days.`}
                  >
                    <MenuIcon tone={lot.completed ? 'neutral' : 'emerald'}>{lot.completed ? <RotateIcon /> : <CheckCircleIcon />}</MenuIcon>
                    <span>
                      <span className="block font-medium">{lot.completed ? 'Move back to in progress' : 'Mark lot completed'}</span>
                      {!lot.completed && <span className="block text-xs text-surface-400">Deletes after {COMPLETED_DELETE_DAYS} days</span>}
                    </span>
                  </button>
                </>
              )}
            </Dropdown>

            <button
              onClick={handleListClick}
              disabled={listDisabled || lot.cardItems.length === 0}
              className="btn btn-primary px-3 sm:px-4"
              title={listTitle}
            >
              {listing ? <div className="spinner w-4 h-4 border-white/30 border-t-white" /> : <TagIcon size={16} />}
              <span className="hidden sm:inline">List on eBay</span>
              {ebayReady && listableCount > 0 && (
                <span className="ml-0.5 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-white/20 text-[11px] font-semibold flex items-center justify-center tabular-nums">
                  {listableCount}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="md:hidden px-3 pb-3">{searchBox('flex')}</div>
      </header>

      <main className="flex-1 p-3 sm:p-4 min-h-0">
        {error && (
          <div className="mb-3 flex items-center justify-between gap-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-200 text-sm animate-slide-up">
            <span className="flex items-center gap-2"><AlertIcon className="flex-shrink-0" /> {error}</span>
            <button onClick={() => setError(null)} className="text-red-300 hover:text-red-100" aria-label="Dismiss">
              <CloseIcon />
            </button>
          </div>
        )}

        {lot.cardItems.length === 0 ? (
          <div className="panel relative overflow-hidden min-h-[60vh] flex items-center justify-center px-6 py-16">
            <div className="absolute inset-0 bg-[radial-gradient(600px_300px_at_50%_0%,rgba(74,118,251,0.14),transparent_70%)] pointer-events-none" />
            <div className="relative text-center max-w-xl w-full">
              <h2 className="text-xl font-semibold text-white">Add cards to this lot</h2>
              <p className="mt-2 text-sm text-surface-400">Pick how you want to bring them in. You can mix both.</p>
              <div className="mt-8 grid sm:grid-cols-2 gap-3 text-left">
                <Link href={`/lots/${lotId}/import`} className="group panel p-5 hover:shadow-lift hover:-translate-y-0.5 transition-all">
                  <span className="w-10 h-10 rounded-xl bg-primary-500/15 text-primary-300 flex items-center justify-center mb-4 group-hover:shadow-glow transition-shadow">
                    <UploadIcon size={20} />
                  </span>
                  <span className="block font-medium text-white">Import photos</span>
                  <span className="block mt-1 text-xs text-surface-400">Drop front and back scans; each pair becomes a card.</span>
                </Link>
                <button onClick={() => setShowPSAImport(true)} className="group panel p-5 text-left hover:shadow-lift hover:-translate-y-0.5 transition-all">
                  <span className="w-10 h-10 rounded-xl bg-accent-500/15 text-accent-300 flex items-center justify-center mb-4">
                    <ShieldIcon size={20} />
                  </span>
                  <span className="block font-medium text-white">PSA cert numbers</span>
                  <span className="block mt-1 text-xs text-surface-400">Paste up to 100 certs and we fill in the details.</span>
                </button>
              </div>
              <button onClick={() => setShowDefaults(true)} className="mt-6 text-xs text-surface-400 hover:text-surface-200 inline-flex items-center gap-1.5">
                <SlidersIcon size={13} /> Set lot defaults first
              </button>
            </div>
          </div>
        ) : isMobile ? (
          <MobileCardList
            cards={lot.cardItems}
            lotListingType={lot.exportProfile?.listingType ?? 'Auction'}
            searchText={searchText}
            onCardsChange={handleCardsChange}
            onCloneCard={handleCloneCard}
            onDeleteCard={handleDeleteCard}
            notify={notify}
          />
        ) : (
          <div className="h-[calc(100vh-96px)] panel overflow-hidden flex flex-col">
            <CardGrid
              cards={lot.cardItems}
              lotListingType={lot.exportProfile?.listingType ?? 'Auction'}
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
        cards={lot.cardItems}
        onSaved={fetchLot}
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
        <div className="modal-overlay" onClick={() => setListResult(null)}>
          <div
            className="modal-content w-full max-w-lg mx-4 sm:mx-auto max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 p-5 border-b border-white/[0.07]">
              <div className="flex items-center gap-3">
                <span className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                  listResult.failedCount === 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                }`}>
                  {listResult.failedCount === 0 ? <SparklesIcon size={22} /> : <AlertIcon size={22} />}
                </span>
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    {listResult.failedCount === 0 && listResult.listedCount > 0
                      ? `${listResult.listedCount} ${listResult.listedCount === 1 ? 'card is' : 'cards are'} live on eBay`
                      : 'eBay listing results'}
                  </h2>
                  <p className="text-sm text-surface-400">
                    Listed {listResult.listedCount} · Failed {listResult.failedCount}
                  </p>
                </div>
              </div>
              <button onClick={() => setListResult(null)} className="btn btn-ghost btn-icon" aria-label="Close">
                <CloseIcon size={18} />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3 text-sm">
              {listResult.remainingReady > 0 && (
                <p className="text-surface-200">
                  {listResult.remainingReady} more ready {listResult.remainingReady === 1 ? 'card is' : 'cards are'} waiting. List again to publish them.
                </p>
              )}
              {(listResult.skippedAlreadyListed > 0 || listResult.skippedNotReady > 0) && (
                <p className="text-surface-400">
                  Skipped {listResult.skippedAlreadyListed} already listed and {listResult.skippedNotReady} missing required fields.
                </p>
              )}
              <ul className="space-y-2">
                {listResult.results.map((result) => (
                  <li key={result.cardId} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                    <span className={result.success ? 'text-emerald-300' : 'text-red-300'}>
                      {result.success ? <CheckCircleIcon /> : <AlertIcon />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-surface-100 truncate">{result.title}</div>
                      {!result.success && <div className="text-xs text-red-300">{result.error}</div>}
                    </div>
                    {result.success && result.listingUrl && (
                      <a href={result.listingUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm text-primary-300">
                        View <ExternalIcon size={13} />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {celebrate && <Confetti />}

      <LotDefaultsModal
        isOpen={showDefaults}
        defaults={cardDefaults}
        cardCount={lot.cardItems.length}
        onClose={() => setShowDefaults(false)}
        onSave={saveCardDefaults}
      />

      {toasts.length > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center gap-2 pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role="status"
              className="pointer-events-auto flex items-center gap-3 pl-4 pr-2 py-2 rounded-full border border-white/10 bg-surface-850/95 backdrop-blur-xl shadow-pop text-sm text-surface-100 animate-slide-up"
            >
              <span className="max-w-[60vw] truncate">{toast.message}</span>
              {toast.actionLabel ? (
                <button onClick={toast.onAction} className="btn btn-sm bg-primary-500/20 text-primary-200 hover:bg-primary-500/30 rounded-full">
                  {toast.actionLabel}
                </button>
              ) : (
                <button onClick={() => dismissToast(toast.id)} className="p-1 rounded-full text-surface-500 hover:text-surface-200" aria-label="Dismiss">
                  <CloseIcon size={14} />
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

function MenuIcon({ tone = 'neutral', children }: { tone?: 'neutral' | 'primary' | 'accent' | 'emerald'; children: React.ReactNode }) {
  const tones = {
    neutral: 'bg-white/[0.05] text-surface-300',
    primary: 'bg-primary-500/15 text-primary-300',
    accent: 'bg-accent-500/15 text-accent-300',
    emerald: 'bg-emerald-500/15 text-emerald-300',
  };
  return <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${tones[tone]}`}>{children}</span>;
}

/** Circular progress of cards that are ready or already listed. */
function ReadinessRing({ done, total }: { done: number; total: number }) {
  const size = 36;
  const stroke = 3.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = total === 0 ? 0 : done / total;
  const complete = total > 0 && done === total;
  return (
    <div className="relative flex-shrink-0 hidden sm:block" style={{ width: size, height: size }} title={`${done} of ${total} cards ready or listed`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={complete ? '#34d399' : 'url(#readiness-gradient)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)' }}
        />
        <defs>
          <linearGradient id="readiness-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6b95ff" />
            <stop offset="100%" stopColor="#9a66ff" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tabular-nums text-surface-200">
        {complete ? <CheckIcon size={14} className="text-emerald-300" /> : `${Math.round(fraction * 100)}`}
      </span>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="h-16 border-b border-white/[0.06] px-5 flex items-center gap-3">
        <div className="skeleton w-8 h-8 rounded-lg" />
        <div className="skeleton w-9 h-9 rounded-full" />
        <div className="space-y-1.5">
          <div className="skeleton h-4 w-48" />
          <div className="skeleton h-3 w-24" />
        </div>
        <div className="ml-auto flex gap-2">
          <div className="skeleton h-9 w-56 hidden md:block" />
          <div className="skeleton h-9 w-28" />
          <div className="skeleton h-9 w-32" />
        </div>
      </div>
      <div className="p-4 flex-1">
        <div className="panel h-full p-3 space-y-2">
          <div className="skeleton h-8 w-full" />
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton h-12 w-full" style={{ opacity: 1 - i * 0.1 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

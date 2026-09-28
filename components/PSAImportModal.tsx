'use client';

import { useState } from 'react';

const MAX_CERTS = 100;
const INITIAL_SLOTS = 12;
/** Slots grow a row at a time; 4 matches the widest grid. */
const SLOT_STEP = 4;
const MIN_CERT_DIGITS = 5;
/** Certs per request, so a 100-cert import shows progress instead of one long silent request. */
const IMPORT_BATCH_SIZE = 10;

function emptyCertSlots(): string[] {
  return Array(INITIAL_SLOTS).fill('');
}

function cleanCert(value: string): string {
  return value.trim().replace(/\D/g, '');
}

/** Keeps one empty row after the last filled slot, between INITIAL_SLOTS and MAX_CERTS. */
function resizeSlots(slots: string[]): string[] {
  let lastFilled = -1;
  slots.forEach((value, index) => {
    if (value.trim()) lastFilled = index;
  });
  const target = Math.min(
    MAX_CERTS,
    Math.max(INITIAL_SLOTS, Math.ceil((lastFilled + 1) / SLOT_STEP) * SLOT_STEP + SLOT_STEP)
  );
  const next = slots.slice(0, Math.max(target, lastFilled + 1));
  while (next.length < target) next.push('');
  return next;
}

type SlotStatus = 'empty' | 'valid' | 'short' | 'duplicate';

function slotStatuses(slots: string[]): SlotStatus[] {
  const seen = new Set<string>();
  return slots.map((value) => {
    const clean = cleanCert(value);
    if (!clean) return 'empty';
    if (clean.length < MIN_CERT_DIGITS) return 'short';
    if (seen.has(clean)) return 'duplicate';
    seen.add(clean);
    return 'valid';
  });
}

function focusSlot(index: number) {
  requestAnimationFrame(() => {
    const input = document.getElementById(`psa-cert-${index}`) as HTMLInputElement | null;
    input?.focus();
    input?.select();
  });
}

interface ImportResult {
  certNumber: string;
  success: boolean;
  error?: string;
  cardId?: string;
}

interface PSAImportModalProps {
  lotId: string;
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

export default function PSAImportModal({
  lotId,
  isOpen,
  onClose,
  onImportComplete,
}: PSAImportModalProps) {
  const [certSlots, setCertSlots] = useState<string[]>(emptyCertSlots);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const statuses = slotStatuses(certSlots);
  const certNumbers = certSlots.filter((_, index) => statuses[index] === 'valid').map(cleanCert);
  const duplicateCount = statuses.filter((s) => s === 'duplicate').length;
  const shortCount = statuses.filter((s) => s === 'short').length;
  const atCapacity = certSlots.length >= MAX_CERTS && certSlots.every((value) => value.trim());

  const setSlot = (index: number, value: string) => {
    setNotice(null);
    setCertSlots((prev) => {
      const next = [...prev];
      next[index] = value;
      return resizeSlots(next);
    });
  };

  const handlePaste = (index: number, event: React.ClipboardEvent<HTMLInputElement>) => {
    const tokens = event.clipboardData
      .getData('text')
      .split(/[\s,;|]+/)
      .map(cleanCert)
      .filter(Boolean);
    if (tokens.length <= 1) return;
    event.preventDefault();

    const existing = new Set(
      certSlots.filter((_, i) => i !== index).map(cleanCert).filter(Boolean)
    );
    const unique: string[] = [];
    let skippedDuplicates = 0;
    for (const token of tokens) {
      if (existing.has(token)) {
        skippedDuplicates++;
        continue;
      }
      existing.add(token);
      unique.push(token);
    }

    const next = [...certSlots];
    let cursor = index;
    let placed = 0;
    for (const token of unique) {
      while (cursor < MAX_CERTS && cursor !== index && next[cursor]?.trim()) cursor++;
      if (cursor >= MAX_CERTS) break;
      next[cursor] = token;
      placed++;
      cursor++;
    }
    const dropped = unique.length - placed;

    const messages = [`Pasted ${placed} cert${placed !== 1 ? 's' : ''}`];
    if (skippedDuplicates > 0) {
      messages.push(`skipped ${skippedDuplicates} already in the list`);
    }
    if (dropped > 0) {
      messages.push(`${dropped} didn't fit (limit is ${MAX_CERTS})`);
    }
    setNotice(messages.join(', ') + '.');
    setError(null);
    setCertSlots(resizeSlots(next));
    focusSlot(Math.min(cursor, MAX_CERTS - 1));
  };

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      focusSlot(Math.min(index + 1, certSlots.length - 1));
    } else if (event.key === 'Backspace' && !certSlots[index] && index > 0) {
      event.preventDefault();
      focusSlot(index - 1);
    }
  };

  const clearAll = () => {
    setCertSlots(emptyCertSlots());
    setNotice(null);
    setError(null);
    focusSlot(0);
  };

  if (!isOpen) return null;

  const handleImport = async () => {
    if (certNumbers.length === 0) {
      setError('Please enter at least one valid cert number');
      return;
    }

    setImporting(true);
    setError(null);
    setNotice(null);
    setResults(null);
    setProgress({ done: 0, total: certNumbers.length });

    const collected: ImportResult[] = [];
    let anySuccess = false;

    for (let start = 0; start < certNumbers.length; start += IMPORT_BATCH_SIZE) {
      const batch = certNumbers.slice(start, start + IMPORT_BATCH_SIZE);
      try {
        const response = await fetch(`/api/lots/${lotId}/import-psa`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ certNumbers: batch }),
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Import failed');
        collected.push(...data.data.results);
        if (data.data.successCount > 0) anySuccess = true;
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Failed to connect to server';
        for (const certNumber of certNumbers.slice(start)) {
          collected.push({ certNumber, success: false, error: `Not imported: ${reason}` });
        }
        break;
      }
      setProgress({ done: Math.min(start + batch.length, certNumbers.length), total: certNumbers.length });
    }

    setResults(collected);
    setImporting(false);
    setProgress(null);
    if (anySuccess) onImportComplete();
  };

  const handleClose = () => {
    if (importing) return;
    setCertSlots(emptyCertSlots());
    setResults(null);
    setError(null);
    setNotice(null);
    onClose();
  };

  const successCount = results?.filter(r => r.success).length ?? 0;
  const failedCount = results?.filter(r => !r.success).length ?? 0;
  const retryableCerts =
    results?.filter((r) => !r.success && !r.error?.includes('already exists')).map((r) => r.certNumber) ?? [];

  return (
    <div className="modal-overlay animate-fade-in" onClick={handleClose}>
      <div
        className="modal-content w-full max-w-3xl mx-4 sm:mx-auto animate-slide-up max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-surface-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-semibold">Import from PSA</h2>
              <p className="text-xs sm:text-sm text-surface-400">
                Enter PSA certification numbers to auto-populate card data
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={importing}
            className="btn-ghost p-2 rounded-lg flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1">
          {!results ? (
            <>
              <div className="mb-4">
                <div className="flex items-end justify-between gap-3 mb-1">
                  <label className="block text-sm font-medium text-surface-300">
                    PSA certification numbers
                  </label>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-surface-400 tabular-nums">
                      {certNumbers.length} / {MAX_CERTS}
                    </span>
                    {certSlots.some((value) => value.trim()) && !importing && (
                      <button type="button" onClick={clearAll} className="text-surface-400 hover:text-surface-200 underline">
                        Clear all
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-surface-500 mb-3">
                  Up to {MAX_CERTS} certs. Paste a list separated by commas, spaces, or new lines into any box and
                  it fills the boxes from there. More boxes appear as you go.
                </p>
                <div
                  className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 max-h-[42vh] overflow-y-auto pr-1 -mr-1"
                  role="group"
                  aria-label="PSA certification number inputs"
                >
                  {certSlots.map((value, index) => {
                    const status = statuses[index];
                    const flagged = status === 'short' || status === 'duplicate';
                    return (
                      <div key={index} className="relative min-w-0">
                        <label
                          htmlFor={`psa-cert-${index}`}
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-medium text-surface-500 tabular-nums pointer-events-none"
                        >
                          {index + 1}
                        </label>
                        <input
                          id={`psa-cert-${index}`}
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder={index === 0 ? 'Paste or type' : ''}
                          value={value}
                          onChange={(e) => setSlot(index, e.target.value)}
                          onPaste={(e) => handlePaste(index, e)}
                          onKeyDown={(e) => handleKeyDown(index, e)}
                          disabled={importing}
                          title={
                            status === 'duplicate'
                              ? 'Duplicate — will be skipped'
                              : status === 'short'
                                ? `Too short — needs ${MIN_CERT_DIGITS}+ digits`
                                : undefined
                          }
                          className={`w-full min-h-[44px] pl-8 pr-2.5 py-2 text-sm sm:text-base bg-surface-800 border rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono tabular-nums ${
                            flagged ? 'border-amber-500/70 text-amber-200' : 'border-surface-600'
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 text-xs space-y-1">
                  <p className="text-surface-400">
                    {certNumbers.length > 0 ? (
                      <span className="text-primary-400">
                        {certNumbers.length} cert{certNumbers.length !== 1 ? 's' : ''} ready to import
                      </span>
                    ) : (
                      `Fill at least one box with a valid cert number (${MIN_CERT_DIGITS}+ digits)`
                    )}
                    {duplicateCount > 0 && (
                      <span className="text-amber-300"> · {duplicateCount} duplicate{duplicateCount !== 1 ? 's' : ''} will be skipped</span>
                    )}
                    {shortCount > 0 && (
                      <span className="text-amber-300"> · {shortCount} too short</span>
                    )}
                  </p>
                  {notice && <p className="text-surface-300">{notice}</p>}
                  {atCapacity && <p className="text-amber-300">All {MAX_CERTS} boxes are full.</p>}
                </div>
              </div>

              {importing && progress ? (
                <div className="p-4 bg-surface-800/50 border border-surface-700 rounded-lg">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-surface-200">Importing from PSA…</span>
                    <span className="text-surface-400 tabular-nums">
                      {progress.done} / {progress.total}
                    </span>
                  </div>
                  <div className="h-2 bg-surface-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 transition-all duration-300"
                      style={{ width: `${(progress.done / progress.total) * 100}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-surface-500">Keep this window open until it finishes.</p>
                </div>
              ) : (
                <>
                  {/* Info Box */}
                  <div className="p-4 bg-blue-900/20 border border-blue-700/50 rounded-lg mb-4">
                    <h4 className="font-medium text-blue-300 mb-2 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      What gets imported
                    </h4>
                    <ul className="text-sm text-surface-300 space-y-1">
                      <li>• Player/Subject name, Year, Brand, Set, Card number</li>
                      <li>• Grade and Grader (auto-set to PSA)</li>
                      <li>• Front and back images (when available from PSA)</li>
                      <li>• Certification number for verification</li>
                    </ul>
                  </div>

                  {/* Rate Limit Notice */}
                  <div className="p-3 bg-surface-800/50 border border-surface-700 rounded-lg text-xs text-surface-400">
                    <strong className="text-surface-300">Note:</strong> PSA API has a daily limit; each cert uses one lookup.
                  </div>
                </>
              )}

              {error && (
                <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
                  {error}
                </div>
              )}
            </>
          ) : (
            /* Results Section */
            <div>
              {/* Summary */}
              <div className="flex items-center gap-4 mb-4 p-4 bg-surface-800/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-green-900/50 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-green-400">{successCount}</div>
                    <div className="text-xs text-surface-400">Imported</div>
                  </div>
                </div>
                {failedCount > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-red-900/50 rounded-full flex items-center justify-center">
                      <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-red-400">{failedCount}</div>
                      <div className="text-xs text-surface-400">Failed</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Results List: failures first so they're not buried under 100 successes */}
              <div className="space-y-2 max-h-[45vh] overflow-y-auto">
                {[...results].sort((a, b) => Number(a.success) - Number(b.success)).map((result, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between gap-3 p-3 rounded-lg ${
                      result.success ? 'bg-green-900/20 border border-green-700/50' : 'bg-red-900/20 border border-red-700/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {result.success ? (
                        <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                      <span className="font-mono text-sm">{result.certNumber}</span>
                    </div>
                    {result.error && (
                      <span className="text-xs text-red-400 text-right">{result.error}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 sm:p-5 border-t border-surface-700 flex-shrink-0">
          {!results ? (
            <>
              <button onClick={handleClose} disabled={importing} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={importing || certNumbers.length === 0}
                className="btn btn-primary"
              >
                {importing ? (
                  <>
                    <div className="spinner w-4 h-4"></div>
                    Importing...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Import {certNumbers.length > 0 ? `${certNumbers.length} Card${certNumbers.length !== 1 ? 's' : ''}` : 'Cards'}
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              {retryableCerts.length > 0 && (
                <button
                  onClick={() => {
                    setResults(null);
                    setCertSlots(resizeSlots([...retryableCerts]));
                  }}
                  className="btn btn-secondary"
                >
                  Retry {retryableCerts.length} Failed
                </button>
              )}
              <button
                onClick={() => {
                  setResults(null);
                  setCertSlots(emptyCertSlots());
                }}
                className="btn btn-secondary"
              >
                Import More
              </button>
              <button onClick={handleClose} className="btn btn-primary">
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

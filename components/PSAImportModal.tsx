'use client';

import { useState } from 'react';

const CERT_SLOT_COUNT = 12;

function emptyCertSlots(): string[] {
  return Array(CERT_SLOT_COUNT).fill('');
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
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const certNumbers = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of certSlots) {
      const clean = s.trim().replace(/\D/g, '');
      if (clean.length >= 5 && !seen.has(clean)) {
        seen.add(clean);
        out.push(clean);
      }
    }
    return out;
  })();

  const setSlot = (index: number, value: string) => {
    setCertSlots((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  if (!isOpen) return null;

  const handleImport = async () => {
    if (certNumbers.length === 0) {
      setError('Please enter at least one valid cert number');
      return;
    }

    setImporting(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch(`/api/lots/${lotId}/import-psa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certNumbers }),
      });

      const data = await response.json();

      if (data.success) {
        setResults(data.data.results);
        if (data.data.successCount > 0) {
          onImportComplete();
        }
      } else {
        setError(data.error || 'Import failed');
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setCertSlots(emptyCertSlots());
    setResults(null);
    setError(null);
    onClose();
  };

  const successCount = results?.filter(r => r.success).length ?? 0;
  const failedCount = results?.filter(r => !r.success).length ?? 0;

  return (
    <div className="modal-overlay animate-fade-in" onClick={handleClose}>
      <div
        className="modal-content w-full max-w-2xl mx-4 sm:mx-auto animate-slide-up max-h-[90vh] flex flex-col"
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
              {/* 12 cert slots: 3 columns × 4 rows on sm+; 2 cols on narrow phones */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  PSA certification numbers
                </label>
                <p className="text-xs text-surface-500 mb-3">
                  Up to 12 certs — leave blanks empty. Digits only; non-digits are ignored.
                </p>
                <div
                  className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-3"
                  role="group"
                  aria-label="PSA certification number inputs"
                >
                  {certSlots.map((value, index) => (
                    <div key={index} className="min-w-0">
                      <label
                        htmlFor={`psa-cert-${index}`}
                        className="block text-[10px] sm:text-xs font-medium text-surface-500 mb-1 uppercase tracking-wide"
                      >
                        Cert {index + 1}
                      </label>
                      <input
                        id={`psa-cert-${index}`}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="e.g. 12345678"
                        value={value}
                        onChange={(e) => setSlot(index, e.target.value)}
                        disabled={importing}
                        className="w-full min-h-[44px] px-2.5 sm:px-3 py-2 text-sm sm:text-base bg-surface-800 border border-surface-600 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono tabular-nums"
                      />
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-surface-400">
                  {certNumbers.length > 0 ? (
                    <span className="text-primary-400">
                      {certNumbers.length} cert{certNumbers.length !== 1 ? 's' : ''} ready to import
                    </span>
                  ) : (
                    'Fill at least one field with a valid cert number (5+ digits)'
                  )}
                </p>
              </div>

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
                  <li>• Front and back image links from PSA (hotlinked to cert-images.psa.com, not stored here)</li>
                  <li>• Certification number for verification</li>
                </ul>
              </div>

              {/* Rate Limit Notice */}
              <div className="p-3 bg-surface-800/50 border border-surface-700 rounded-lg text-xs text-surface-400">
                <strong className="text-surface-300">Note:</strong> PSA API has a daily limit; each cert uses one lookup.
              </div>

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

              {/* Results List */}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {results.map((result, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between p-3 rounded-lg ${
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
                      <span className="text-xs text-red-400">{result.error}</span>
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
              <button onClick={handleClose} className="btn btn-secondary">
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

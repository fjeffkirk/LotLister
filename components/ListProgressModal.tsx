'use client';

import { useEffect, useRef } from 'react';
import { AlertIcon, CheckCircleIcon, CloseIcon, ExternalIcon } from './ui/icons';
import type { ListRun } from '../lib/list-progress';

interface ListProgressModalProps {
  run: ListRun;
  thumbs: Record<string, string>;
  onClose: () => void;
}

function money(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '';
  return `$${value.toFixed(2)}`;
}

export default function ListProgressModal({ run, thumbs, onClose }: ListProgressModalProps) {
  const busy = run.phase === 'saving' || run.phase === 'running';
  const finished = run.items.filter((item) => item.status === 'listed' || item.status === 'failed').length;
  const total = run.total || run.items.length;
  const pct = total === 0 ? (busy ? 8 : 0) : Math.round((finished / total) * 100);
  const activeRef = useRef<HTMLLIElement | null>(null);
  const activeId = run.items.find((item) => item.status === 'sending')?.cardId;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeId, finished]);

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div
        className="modal-content w-full max-w-lg mx-4 sm:mx-auto max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-white/[0.07] space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">
                {run.phase === 'done' ? 'Listing finished' : run.phase === 'error' ? 'Listing stopped' : 'Listing on eBay'}
              </h2>
              <p className="text-sm text-surface-300 mt-1">{run.detail}</p>
            </div>
            {!busy && (
              <button onClick={onClose} className="btn btn-ghost btn-icon" aria-label="Close">
                <CloseIcon size={18} />
              </button>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${run.phase === 'error' ? 'bg-red-400' : 'bg-primary-500'}`}
              style={{ width: `${run.phase === 'done' ? 100 : pct}%` }}
            />
          </div>
          {total > 0 && (
            <p className="text-xs text-surface-400">
              {finished} of {total} finished
            </p>
          )}
        </div>

        <div className="p-5 overflow-y-auto space-y-3 text-sm flex-1">
          {run.phase === 'saving' && run.items.length === 0 && (
            <p className="text-surface-400">Saving the latest card changes…</p>
          )}
          {(run.skippedAlreadyListed > 0 || run.skippedNotReady > 0) && run.phase !== 'saving' && (
            <p className="text-surface-400">
              Skipped {run.skippedAlreadyListed} already listed and {run.skippedNotReady} missing required fields.
            </p>
          )}
          <ul className="space-y-2">
            {run.items.map((item) => {
              const active = item.status === 'sending';
              return (
                <li
                  key={item.cardId}
                  ref={active ? activeRef : undefined}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                    active ? 'border-primary-500/40 bg-primary-500/10' : 'border-white/[0.07] bg-white/[0.02]'
                  }`}
                >
                  <span className="w-5 flex-shrink-0 flex items-center justify-center">
                    {item.status === 'listed' && <CheckCircleIcon className="text-emerald-300" />}
                    {item.status === 'failed' && <AlertIcon className="text-red-300" />}
                    {item.status === 'sending' && <span className="spinner w-4 h-4" />}
                    {item.status === 'waiting' && <span className="w-2 h-2 rounded-full bg-surface-600" />}
                  </span>
                  {thumbs[item.cardId] && (
                    <img
                      src={thumbs[item.cardId]}
                      alt=""
                      className="w-9 h-12 rounded object-cover bg-surface-800 flex-shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-surface-100 truncate">{item.title || 'Untitled card'}</div>
                    <div className="text-xs text-surface-400 truncate">
                      {[
                        item.format,
                        money(item.price),
                        item.category,
                        item.status === 'sending' ? 'Sending to eBay' : item.status === 'waiting' ? 'Waiting' : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    {item.status === 'failed' && item.error && (
                      <div className="text-xs text-red-300 mt-0.5 whitespace-pre-wrap">{item.error}</div>
                    )}
                  </div>
                  {item.status === 'listed' && item.listingUrl && (
                    <a href={item.listingUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm text-primary-300">
                      View <ExternalIcon size={13} />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {!busy && (
          <div className="flex justify-end p-4 border-t border-white/[0.07]">
            <button onClick={onClose} className="btn btn-primary">
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import SearchableSelect from './SearchableSelect';
import {
  CardDefaults,
  CONDITION_FIELD_OPTIONS,
  DEFAULT_RAW_CONDITION,
  DEFAULT_SUBSET,
  DESCRIPTION_TOKENS,
  GRADED_CONDITION_TYPE,
  GRADER_FIELD_OPTIONS,
  parsePrice,
  parseYear,
  RAW_CONDITION_TYPE,
} from '../lib/card-fields';

interface LotDefaultsModalProps {
  isOpen: boolean;
  defaults: CardDefaults;
  cardCount: number;
  onClose: () => void;
  onSave: (defaults: Record<string, unknown>, fillExisting: boolean) => Promise<void>;
}

interface FormState {
  category: string;
  year: string;
  brand: string;
  setName: string;
  subsetParallel: string;
  conditionType: string;
  condition: string;
  grader: string;
  salePrice: string;
  description: string;
}

function toForm(defaults: CardDefaults): FormState {
  const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
  return {
    category: text(defaults.category),
    year: text(defaults.year),
    brand: text(defaults.brand),
    setName: text(defaults.setName),
    subsetParallel: text(defaults.subsetParallel) || DEFAULT_SUBSET,
    conditionType: text(defaults.conditionType) || RAW_CONDITION_TYPE,
    condition: text(defaults.condition) || DEFAULT_RAW_CONDITION,
    grader: text(defaults.grader),
    salePrice: text(defaults.salePrice),
    description: text(defaults.description),
  };
}

export default function LotDefaultsModal({ isOpen, defaults, cardCount, onClose, onSave }: LotDefaultsModalProps) {
  const [form, setForm] = useState<FormState>(() => toForm(defaults));
  const [fillExisting, setFillExisting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setForm(toForm(defaults));
      setFillExisting(true);
      setError(null);
    }
  }, [isOpen, defaults]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const graded = form.conditionType === GRADED_CONDITION_TYPE;
  const set = (field: keyof FormState) => (value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  function insertToken(token: string) {
    const el = descriptionRef.current;
    const start = el?.selectionStart ?? form.description.length;
    const end = el?.selectionEnd ?? form.description.length;
    const next = form.description.slice(0, start) + token + form.description.slice(end);
    set('description')(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const year = parseYear(form.year);
    if (year === undefined) {
      setError('Year must be a 4-digit year, like 2023.');
      return;
    }
    const salePrice = parsePrice(form.salePrice);
    if (salePrice === undefined) {
      setError('Price must be a number, like 4.99.');
      return;
    }

    const blankToNull = (value: string) => value.trim() || null;
    const payload: Record<string, unknown> = {
      category: blankToNull(form.category),
      year,
      brand: blankToNull(form.brand),
      setName: blankToNull(form.setName),
      subsetParallel: blankToNull(form.subsetParallel),
      conditionType: form.conditionType,
      condition: graded ? null : form.condition,
      grader: graded ? blankToNull(form.grader) : null,
      salePrice,
      description: form.description.trim() ? form.description : null,
    };

    setSaving(true);
    setError(null);
    try {
      await onSave(payload, fillExisting && cardCount > 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save defaults');
    } finally {
      setSaving(false);
    }
  }

  const inputClass = 'input text-sm py-1.5';
  const labelClass = 'block text-xs font-medium text-surface-400 mb-1';

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSave}
        className="bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 sm:p-6 animate-slide-up"
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-surface-100">Lot defaults</h2>
            <p className="text-sm text-surface-400 mt-0.5">
              New cards from photos or PSA imports start with these values. Leave a field blank to skip it.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-surface-400 hover:text-surface-200 p-1" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <span className={labelClass}>Category</span>
            <SearchableSelect
              value={form.category}
              onChange={set('category')}
              triggerClassName="input text-sm py-1.5 text-left flex items-center justify-between gap-2"
            />
          </div>

          <label>
            <span className={labelClass}>Year</span>
            <input className={inputClass} inputMode="numeric" placeholder="2024" value={form.year} onChange={(e) => set('year')(e.target.value)} />
          </label>
          <label>
            <span className={labelClass}>Brand</span>
            <input className={inputClass} placeholder="Topps" value={form.brand} onChange={(e) => set('brand')(e.target.value)} />
          </label>
          <label>
            <span className={labelClass}>Set</span>
            <input className={inputClass} placeholder="Chrome" value={form.setName} onChange={(e) => set('setName')(e.target.value)} />
          </label>
          <label>
            <span className={labelClass}>Subset / Parallel</span>
            <input
              className={inputClass}
              placeholder={DEFAULT_SUBSET}
              value={form.subsetParallel}
              onChange={(e) => set('subsetParallel')(e.target.value)}
            />
          </label>

          <div>
            <span className={labelClass}>Graded or raw</span>
            <div className="flex rounded-lg border border-surface-700 overflow-hidden text-sm">
              {[
                { value: RAW_CONDITION_TYPE, label: 'Raw' },
                { value: GRADED_CONDITION_TYPE, label: 'Graded' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => set('conditionType')(option.value)}
                  className={`flex-1 py-1.5 transition-colors ${
                    form.conditionType === option.value
                      ? 'bg-primary-600 text-white'
                      : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {graded ? (
            <label>
              <span className={labelClass}>Grader</span>
              <select className={inputClass} value={form.grader} onChange={(e) => set('grader')(e.target.value)}>
                <option value="">No default</option>
                {GRADER_FIELD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              <span className={labelClass}>Condition</span>
              <select className={inputClass} value={form.condition} onChange={(e) => set('condition')(e.target.value)}>
                {CONDITION_FIELD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            <span className={labelClass}>Sale price</span>
            <input
              className={inputClass}
              inputMode="decimal"
              placeholder="0.99"
              value={form.salePrice}
              onChange={(e) => set('salePrice')(e.target.value)}
            />
          </label>

          <div className="sm:col-span-2">
            <span className={labelClass}>Description template</span>
            <textarea
              ref={descriptionRef}
              className="input text-sm py-1.5 min-h-[96px] font-mono"
              placeholder="{title}&#10;&#10;Ships in a penny sleeve and top loader."
              value={form.description}
              onChange={(e) => set('description')(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {DESCRIPTION_TOKENS.map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => insertToken(token)}
                  className="px-2 py-0.5 rounded bg-surface-800 border border-surface-700 text-xs font-mono text-surface-300 hover:border-primary-500 hover:text-primary-300"
                >
                  {token}
                </button>
              ))}
            </div>
            <p className="text-xs text-surface-500 mt-1.5">
              Tokens are filled in from each card when you export or list. Cards with their own description keep it.
            </p>
          </div>
        </div>

        {cardCount > 0 && (
          <label className="flex items-center gap-2 mt-4 text-sm text-surface-300 cursor-pointer">
            <input type="checkbox" checked={fillExisting} onChange={(e) => setFillExisting(e.target.checked)} />
            Also fill empty fields on the {cardCount} {cardCount === 1 ? 'card' : 'cards'} already in this lot
          </label>
        )}

        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="btn btn-secondary text-sm">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn btn-primary text-sm">
            {saving ? 'Saving…' : 'Save defaults'}
          </button>
        </div>
      </form>
    </div>
  );
}

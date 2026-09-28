'use client';

import { useEffect, useState } from 'react';
import SearchableSelect from '../SearchableSelect';
import { parseFieldValue, SELECT_FIELD_OPTIONS } from '../../lib/card-fields';

export interface BulkField {
  field: string;
  headerName: string;
}

const CLEARABLE_SELECTS = new Set(['grader', 'grade']);

export default function BulkEditModal({
  isOpen,
  fields,
  initialField,
  targetCount,
  scopeLabel,
  onClose,
  onApply,
}: {
  isOpen: boolean;
  fields: BulkField[];
  initialField: string | null;
  targetCount: number;
  scopeLabel: string;
  onClose: () => void;
  onApply: (field: string, value: unknown) => void;
}) {
  const [field, setField] = useState(initialField ?? fields[0]?.field ?? '');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setField(initialField ?? fields[0]?.field ?? '');
      setValue('');
      setError(null);
    }
  }, [isOpen, initialField, fields]);

  if (!isOpen) return null;

  const header = fields.find((f) => f.field === field)?.headerName ?? field;
  const options = SELECT_FIELD_OPTIONS[field];

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFieldValue(field, value);
    if (parsed === undefined) {
      setError(value.trim() ? `"${value}" isn't a valid ${header}.` : `Choose a ${header}.`);
      return;
    }
    onApply(field, parsed);
    onClose();
  };

  return (
    <div className="modal-overlay animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={apply} className="modal-content w-full max-w-md p-6 animate-slide-up">
        <h2 className="text-lg font-semibold mb-1">Bulk edit</h2>
        <p className="text-sm text-surface-400 mb-4">{scopeLabel}</p>

        <label className="block text-sm font-medium text-surface-300 mb-1.5">Column</label>
        <select
          value={field}
          onChange={(e) => {
            setField(e.target.value);
            setValue('');
            setError(null);
          }}
          className="w-full mb-4"
        >
          {fields.map((f) => (
            <option key={f.field} value={f.field}>
              {f.headerName}
            </option>
          ))}
        </select>

        <label className="block text-sm font-medium text-surface-300 mb-1.5">New value</label>
        {field === 'category' ? (
          <SearchableSelect value={value} onChange={setValue} triggerClassName="input text-sm py-2 text-left flex items-center justify-between gap-2" />
        ) : options ? (
          <select value={value} onChange={(e) => setValue(e.target.value)} className="w-full" autoFocus>
            <option value="">{CLEARABLE_SELECTS.has(field) ? '(clear the value)' : '-- Select --'}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full"
            placeholder={`Leave blank to clear ${header.toLowerCase()}`}
            inputMode={field === 'salePrice' ? 'decimal' : field === 'year' ? 'numeric' : undefined}
            autoFocus
          />
        )}

        {error && <p className="text-sm text-red-400 mt-2">{error}</p>}

        <div className="flex justify-end gap-3 mt-5">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={targetCount === 0}>
            Update {targetCount} {targetCount === 1 ? 'card' : 'cards'}
          </button>
        </div>
      </form>
    </div>
  );
}

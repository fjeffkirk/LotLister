'use client';

import { useEffect, useMemo, useState } from 'react';
import { CardItemWithImages } from '../lib/types';
import { COMPLETENESS_LABELS, isCardGraded, isMandatoryFieldEmpty, missingFieldLabels, TITLE_MAX_LENGTH } from '../lib/card-completeness';
import {
  cardListingType,
  CONDITION_FIELD_OPTIONS,
  conditionShortLabel,
  generateAutoTitle,
  GRADE_FIELD_OPTIONS,
  GRADED_CONDITION_TYPE,
  GRADER_FIELD_OPTIONS,
  LISTING_TYPE_FIELD_OPTIONS,
  parseFieldValue,
  RAW_CONDITION_TYPE,
} from '../lib/card-fields';
import { imagePathToBrowserSrc } from '../lib/imageUrls';
import { sortCardImages } from './grid/PhotoPanel';
import SearchableSelect from './SearchableSelect';
import { BoltIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, ImageIcon, TrashIcon } from './ui/icons';

const LABELS: Record<string, string> = { ...COMPLETENESS_LABELS, certNo: 'Cert #', listingType: 'Format' };

const TITLE_FIELDS = new Set(['year', 'brand', 'setName', 'cardNumber', 'name', 'subsetParallel']);

interface MobileCardListProps {
  cards: CardItemWithImages[];
  /** The lot's default listing format, used by cards that haven't been switched. */
  lotListingType: string;
  searchText: string;
  onCardsChange: (updates: { id: string; data: Record<string, unknown> }[]) => void;
  onCloneCard: (cardId: string) => void;
  onDeleteCard: (cardId: string) => void;
  notify: (message: string) => void;
}

/** Phone layout: a stacked list of cards; tapping one opens a full-screen editor. */
export default function MobileCardList({ cards, lotListingType, searchText, onCardsChange, onCloneCard, onDeleteCard, notify }: MobileCardListProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const terms = searchText.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return cards;
    return cards.filter((card) => {
      const text = [card.title, card.name, card.brand, card.setName, card.cardNumber, card.year].join(' ').toLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [cards, searchText]);

  const openIndex = visible.findIndex((card) => card.id === openId);
  const openCard = openIndex >= 0 ? visible[openIndex] : null;

  return (
    <>
      <ul className="space-y-2.5">
        {visible.map((card, index) => {
          const missing = missingFieldLabels(card);
          const thumb = sortCardImages(card.images)[0];
          return (
            <li key={card.id} className="animate-slide-up" style={{ animationDelay: `${Math.min(index, 10) * 25}ms` }}>
              <button onClick={() => setOpenId(card.id)} className="w-full panel flex items-center gap-3 p-2.5 text-left active:scale-[0.99] transition-transform">
                <span className="w-14 h-14 rounded-lg overflow-hidden bg-surface-800 flex items-center justify-center flex-shrink-0">
                  {thumb ? (
                    <img src={imagePathToBrowserSrc(thumb.thumbPath || thumb.originalPath)} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <ImageIcon size={20} className="text-surface-500" />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm truncate ${card.title ? 'text-white' : 'text-surface-500 italic'}`}>
                    {card.title || card.name || 'Untitled card'}
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    {card.ebayItemId ? (
                      <span className="chip chip-info">Listed</span>
                    ) : missing.length === 0 ? (
                      <span className="chip chip-ready"><BoltIcon size={11} /> Ready</span>
                    ) : (
                      <span className="chip chip-warn">{missing.length} to fill</span>
                    )}
                    {typeof card.salePrice === 'number' && <span className="text-xs text-surface-400 tabular-nums">${card.salePrice.toFixed(2)}</span>}
                  </span>
                </span>
                <ChevronRightIcon className="text-surface-500 flex-shrink-0" />
              </button>
            </li>
          );
        })}
        {visible.length === 0 && <li className="py-10 text-center text-sm text-surface-500">No cards match &ldquo;{searchText}&rdquo;</li>}
      </ul>

      {openCard && (
        <CardSheet
          key={openCard.id}
          card={openCard}
          lotListingType={lotListingType}
          position={`${openIndex + 1} of ${visible.length}`}
          onPrev={openIndex > 0 ? () => setOpenId(visible[openIndex - 1].id) : undefined}
          onNext={openIndex < visible.length - 1 ? () => setOpenId(visible[openIndex + 1].id) : undefined}
          onClose={() => setOpenId(null)}
          onChange={(data) => onCardsChange([{ id: openCard.id, data }])}
          onClone={() => onCloneCard(openCard.id)}
          onDelete={() => {
            setOpenId(null);
            onDeleteCard(openCard.id);
          }}
          notify={notify}
        />
      )}
    </>
  );
}

function CardSheet({
  card,
  lotListingType,
  position,
  onPrev,
  onNext,
  onClose,
  onChange,
  onClone,
  onDelete,
  notify,
}: {
  card: CardItemWithImages;
  lotListingType: string;
  position: string;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  onChange: (data: Record<string, unknown>) => void;
  onClone: () => void;
  onDelete: () => void;
  notify: (message: string) => void;
}) {
  const images = useMemo(() => sortCardImages(card.images), [card.images]);
  const [photo, setPhoto] = useState(0);
  const graded = isCardGraded(card);
  const listingType = cardListingType(card, { listingType: lotListingType });
  const autoTitle = generateAutoTitle(card);
  const [manualTitle, setManualTitle] = useState(() => Boolean(card.title?.trim()) && card.title !== autoTitle);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const commit = (field: string, input: unknown) => {
    const parsed = parseFieldValue(field, input);
    if (parsed === undefined) {
      const text = String(input ?? '').trim();
      if (text) notify(`"${text}" isn't a valid ${LABELS[field] ?? field}.`);
      return;
    }
    if (parsed === (card as Record<string, unknown>)[field]) return;
    const data: Record<string, unknown> = { [field]: parsed };
    if (!manualTitle && TITLE_FIELDS.has(field)) data.title = generateAutoTitle({ ...card, [field]: parsed });
    onChange(data);
  };

  const empty = (field: string) =>
    isMandatoryFieldEmpty(field, (card as Record<string, unknown>)[field], card);

  const text = (field: string, props: { inputMode?: 'decimal' | 'numeric'; placeholder?: string; format?: (v: unknown) => string } = {}) => {
    const raw = (card as Record<string, unknown>)[field];
    const value = props.format ? props.format(raw) : raw === null || raw === undefined ? '' : String(raw);
    return (
      <Field label={LABELS[field] ?? field} missing={empty(field)}>
        <input
          key={`${field}-${value}`}
          defaultValue={value}
          onBlur={(e) => commit(field, e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          inputMode={props.inputMode}
          placeholder={props.placeholder}
          className="w-full"
        />
      </Field>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-surface-950 flex flex-col animate-slide-up">
      <header className="glass flex items-center gap-2 px-3 h-14 border-b border-white/[0.06]">
        <button onClick={onClose} className="btn btn-ghost btn-icon" aria-label="Back to list">
          <ChevronLeftIcon size={20} />
        </button>
        <span className="flex-1 text-sm text-surface-400 text-center tabular-nums">Card {position}</span>
        <button onClick={onPrev} disabled={!onPrev} className="btn btn-ghost btn-icon" aria-label="Previous card">
          <ChevronLeftIcon />
        </button>
        <button onClick={onNext} disabled={!onNext} className="btn btn-ghost btn-icon" aria-label="Next card">
          <ChevronRightIcon />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="relative aspect-[4/3] bg-black flex items-center justify-center">
          {images.length > 0 ? (
            <img src={imagePathToBrowserSrc(images[photo]?.originalPath)} alt="" className="max-w-full max-h-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-surface-500">
              <ImageIcon size={28} />
              <span className="text-xs">No photos</span>
            </div>
          )}
          {images.length > 1 && (
            <div className="absolute bottom-3 inset-x-0 flex justify-center gap-1.5">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  onClick={() => setPhoto(i)}
                  className={`h-1.5 rounded-full transition-all ${i === photo ? 'w-5 bg-white' : 'w-1.5 bg-white/40'}`}
                  aria-label={`Photo ${i + 1}`}
                />
              ))}
            </div>
          )}
        </div>

        <div className="p-4 space-y-4 pb-28">
          <Field
            label="Title"
            missing={empty('title')}
            extra={
              <span className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={!card.title?.trim()}
                  onClick={() => {
                    const text = card.title?.trim();
                    if (!text) return;
                    navigator.clipboard?.writeText(text);
                  }}
                  className="text-xs text-surface-300 disabled:opacity-30"
                >
                  Copy
                </button>
                <button onClick={() => {
                  if (manualTitle) onChange({ title: autoTitle });
                  setManualTitle(!manualTitle);
                }} className="text-xs text-primary-300">
                  {manualTitle ? 'Use automatic' : 'Write my own'}
                </button>
              </span>
            }
          >
            {manualTitle ? (
              <input
                key={`title-${card.title}`}
                defaultValue={card.title ?? ''}
                onBlur={(e) => commit('title', e.target.value)}
                className="w-full"
              />
            ) : (
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-surface-200 min-h-[38px]">
                {card.title || <span className="text-surface-500 italic">Fills in from Year, Set, Card #, Name</span>}
              </div>
            )}
            <div className={`mt-1 text-right text-[11px] tabular-nums ${(card.title ?? '').length > TITLE_MAX_LENGTH ? 'text-red-300' : 'text-surface-500'}`}>
              {(card.title ?? '').length}/{TITLE_MAX_LENGTH}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            {text('salePrice', { inputMode: 'decimal', placeholder: '4.99', format: (v) => (typeof v === 'number' ? v.toFixed(2) : '') })}
            {text('year', { inputMode: 'numeric', placeholder: '2024' })}
          </div>

          <Field label="Format">
            <div className="grid grid-cols-2 p-1 rounded-lg bg-white/[0.04] border border-white/[0.06]">
              {LISTING_TYPE_FIELD_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => commit('listingType', option.value)}
                  className={`py-1.5 rounded-md text-sm font-medium transition-colors ${
                    listingType === option.value ? 'bg-primary-500 text-white shadow-glow' : 'text-surface-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-surface-500">
              {listingType === 'BuyItNow' ? 'Sells at the price above, good till cancelled' : 'The price above is the starting bid'}
            </p>
          </Field>

          <Field label="Category" missing={empty('category')}>
            <SearchableSelect
              value={card.category ?? ''}
              onChange={(value) => commit('category', value)}
              triggerClassName="input text-sm py-2 text-left flex items-center justify-between gap-2"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            {text('brand')}
            {text('setName')}
            {text('cardNumber')}
            {text('subsetParallel')}
          </div>
          {text('name')}

          <Field label="Graded or raw">
            <div className="grid grid-cols-2 p-1 rounded-lg bg-white/[0.04] border border-white/[0.06]">
              {[
                { value: RAW_CONDITION_TYPE, label: 'Raw' },
                { value: GRADED_CONDITION_TYPE, label: 'Graded' },
              ].map((option) => (
                <button
                  key={option.label}
                  onClick={() => commit('conditionType', option.value)}
                  className={`py-1.5 rounded-md text-sm font-medium transition-colors ${
                    card.conditionType === option.value ? 'bg-primary-500 text-white shadow-glow' : 'text-surface-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>

          {graded ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Grader" missing={empty('grader')}>
                <select value={card.grader ?? ''} onChange={(e) => commit('grader', e.target.value)} className="w-full">
                  <option value="">Choose…</option>
                  {GRADER_FIELD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Grade" missing={empty('grade')}>
                <select value={card.grade ?? ''} onChange={(e) => commit('grade', e.target.value)} className="w-full">
                  <option value="">Choose…</option>
                  {GRADE_FIELD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <div className="col-span-2">{text('certNo')}</div>
            </div>
          ) : (
            <Field label="Condition" missing={empty('condition')}>
              <select value={card.condition ?? ''} onChange={(e) => commit('condition', e.target.value)} className="w-full">
                {CONDITION_FIELD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{conditionShortLabel(option.value)}</option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Description" missing={empty('description')}>
            <textarea
              key={`description-${card.description}`}
              defaultValue={card.description ?? ''}
              onBlur={(e) => commit('description', e.target.value)}
              rows={4}
              className="w-full text-sm"
              placeholder="Tokens like {title} or {grade} are filled in when you list"
            />
          </Field>

          <div className="flex gap-2 pt-2">
            <button onClick={onClone} className="btn btn-secondary flex-1"><CopyIcon /> Clone</button>
            <button onClick={onDelete} className="btn btn-ghost flex-1 text-red-300 hover:text-red-200"><TrashIcon /> Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, missing, extra, children }: { label: string; missing?: boolean; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-surface-300">
          {label}
          {missing && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Required" />}
        </span>
        {extra}
      </div>
      {children}
    </div>
  );
}

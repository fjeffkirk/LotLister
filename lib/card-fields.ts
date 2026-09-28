/**
 * Field parsing, display labels, lot defaults, and description templates shared by the grid,
 * the import routes, and the exporters. Safe to import from client and server code.
 */

import {
  CATEGORY_OPTIONS,
  CONDITION_OPTIONS,
  CONDITION_TYPE_OPTIONS,
  GRADER_OPTIONS,
  GRADE_OPTIONS,
  SPORTS_CATEGORIES,
  TCG_CATEGORIES,
} from './types';

export const GRADED_CONDITION_TYPE = CONDITION_TYPE_OPTIONS[0];
export const RAW_CONDITION_TYPE = CONDITION_TYPE_OPTIONS[1];
export const DEFAULT_RAW_CONDITION = CONDITION_OPTIONS[0];
export const DEFAULT_SUBSET = 'Base';

export interface FieldOption {
  value: string;
  label: string;
  hint?: string;
}

/** "Professional Sports Authenticator (PSA)" -> "PSA" */
export function graderShortLabel(grader: string): string {
  const match = grader.match(/\(([^)]+)\)\s*$/);
  return match ? match[1] : grader;
}

/** "Near mint or better: Comparable to a fresh pack" -> "Near mint or better" */
export function conditionShortLabel(condition: string): string {
  return condition.split(':')[0].trim();
}

export function conditionTypeShortLabel(conditionType: string): string {
  if (conditionType === GRADED_CONDITION_TYPE) return 'Graded';
  if (conditionType === RAW_CONDITION_TYPE) return 'Raw';
  return conditionType;
}

const POPULAR_GRADERS = ['PSA', 'BGS', 'SGC', 'CGC', 'TAG'];

export const GRADER_FIELD_OPTIONS: FieldOption[] = [...GRADER_OPTIONS]
  .map((value) => ({ value, label: graderShortLabel(value), hint: value.replace(/\s*\([^)]+\)\s*$/, '') }))
  .sort((a, b) => {
    const ai = POPULAR_GRADERS.indexOf(a.label);
    const bi = POPULAR_GRADERS.indexOf(b.label);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return 0;
  });

export const CONDITION_FIELD_OPTIONS: FieldOption[] = CONDITION_OPTIONS.map((value) => ({
  value,
  label: conditionShortLabel(value),
  hint: value.split(':')[1]?.trim(),
}));

export const CONDITION_TYPE_FIELD_OPTIONS: FieldOption[] = [
  { value: GRADED_CONDITION_TYPE, label: 'Graded', hint: 'Professionally graded slab' },
  { value: RAW_CONDITION_TYPE, label: 'Raw', hint: 'Ungraded' },
];

export const GRADE_FIELD_OPTIONS: FieldOption[] = GRADE_OPTIONS.map((value) => ({ value, label: value }));

export const CATEGORY_FIELD_OPTIONS: FieldOption[] = CATEGORY_OPTIONS.map((value) => ({
  value,
  label: value,
  hint: (SPORTS_CATEGORIES as readonly string[]).includes(value)
    ? 'Sports'
    : (TCG_CATEGORIES as readonly string[]).includes(value)
      ? 'TCG'
      : 'Non-sport',
}));

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
}

/**
 * Ranks options against a typed query: exact label, label prefix, word prefix, then substring.
 * Every query word must appear somewhere in the label, value, or hint.
 */
export function filterOptions(options: FieldOption[], query: string): FieldOption[] {
  const q = normalize(query);
  if (!q) return options;
  const words = q.split(' ');
  const scored: { option: FieldOption; score: number; index: number }[] = [];
  options.forEach((option, index) => {
    const label = normalize(option.label);
    const haystack = `${label} ${normalize(option.value)} ${normalize(option.hint ?? '')}`;
    if (!words.every((word) => haystack.includes(word))) return;
    let score = 3;
    if (label === q) score = 0;
    else if (label.startsWith(q)) score = 1;
    else if (label.split(' ').some((part) => part.startsWith(words[0]))) score = 2;
    scored.push({ option, score, index });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((s) => s.option);
}

/** Best single option for free text (paste, fill), or undefined if nothing matches confidently. */
export function matchOption(options: FieldOption[], text: string): string | undefined {
  const q = normalize(text);
  if (!q) return undefined;
  const exact = options.find((o) => normalize(o.value) === q || normalize(o.label) === q);
  if (exact) return exact.value;
  const ranked = filterOptions(options, text);
  return ranked.length > 0 && (ranked.length === 1 || normalize(ranked[0].label).startsWith(q))
    ? ranked[0].value
    : undefined;
}

export function parsePrice(input: unknown): number | null | undefined {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? Math.round(input * 100) / 100 : undefined;
  const text = String(input).replace(/[$,\s]/g, '');
  if (!text) return null;
  if (!/^\d*\.?\d+$/.test(text)) return undefined;
  return Math.round(parseFloat(text) * 100) / 100;
}

export function parseYear(input: unknown, now = new Date()): number | null | undefined {
  if (input === null || input === undefined) return null;
  const text = String(input).trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})(?:[-/]\d{2,4})?$/);
  if (!match) return undefined;
  const year = parseInt(match[1], 10);
  return year >= 1880 && year <= now.getFullYear() + 1 ? year : undefined;
}

export function parseGrade(input: unknown): string | null | undefined {
  if (input === null || input === undefined) return null;
  const text = String(input).trim();
  if (!text) return null;
  const numeric = text.match(/(\d+(?:\.\d)?)\s*$/);
  if (!numeric) return undefined;
  const value = String(parseFloat(numeric[1]));
  return (GRADE_OPTIONS as readonly string[]).includes(value) ? value : undefined;
}

function parseConditionType(input: string): string | undefined {
  const q = normalize(input);
  if (!q) return undefined;
  if (q.startsWith('graded') || q === 'g' || q === 'slab') return GRADED_CONDITION_TYPE;
  if (q.startsWith('raw') || q.startsWith('ungraded') || q === 'r') return RAW_CONDITION_TYPE;
  return undefined;
}

export const TEXT_FIELDS = [
  'title',
  'brand',
  'setName',
  'name',
  'cardNumber',
  'subsetParallel',
  'attributes',
  'team',
  'variation',
  'certNo',
  'description',
] as const;

export const SELECT_FIELD_OPTIONS: Record<string, FieldOption[]> = {
  category: CATEGORY_FIELD_OPTIONS,
  conditionType: CONDITION_TYPE_FIELD_OPTIONS,
  condition: CONDITION_FIELD_OPTIONS,
  grader: GRADER_FIELD_OPTIONS,
  grade: GRADE_FIELD_OPTIONS,
};

/**
 * Converts typed or pasted text into a stored value for a card field.
 * Returns undefined when the text isn't valid for that field, so callers can skip it.
 */
export function parseFieldValue(field: string, input: unknown): unknown {
  if (field === 'salePrice') return parsePrice(input);
  if (field === 'year') return parseYear(input);
  if (field === 'grade') return parseGrade(input);
  const text = input === null || input === undefined ? '' : String(input).trim();
  if (field === 'conditionType') return parseConditionType(text) ?? matchOption(CONDITION_TYPE_FIELD_OPTIONS, text);
  if (field in SELECT_FIELD_OPTIONS) {
    if (!text) return field === 'category' || field === 'condition' ? undefined : null;
    return matchOption(SELECT_FIELD_OPTIONS[field], text);
  }
  if ((TEXT_FIELDS as readonly string[]).includes(field)) return text || null;
  return undefined;
}

export function isFieldEditable(field: string): boolean {
  return field in SELECT_FIELD_OPTIONS || field === 'salePrice' || field === 'year' || (TEXT_FIELDS as readonly string[]).includes(field);
}

// ─── Lot defaults ───────────────────────────────────────────────────────────

export const DEFAULTABLE_FIELDS = [
  'category',
  'year',
  'brand',
  'setName',
  'subsetParallel',
  'conditionType',
  'condition',
  'grader',
  'salePrice',
  'description',
] as const;
export type DefaultableField = (typeof DEFAULTABLE_FIELDS)[number];
export type CardDefaults = Partial<Record<DefaultableField, string | number | null>>;

export function parseCardDefaults(json: string | null | undefined): CardDefaults {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const out: CardDefaults = {};
    for (const field of DEFAULTABLE_FIELDS) {
      const value = parsed[field];
      if (typeof value === 'string' || typeof value === 'number') out[field] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Keeps only valid, non-empty default values. */
export function sanitizeCardDefaults(input: Record<string, unknown>): CardDefaults {
  const out: CardDefaults = {};
  for (const field of DEFAULTABLE_FIELDS) {
    const raw = input[field];
    if (raw === null || raw === undefined || raw === '') continue;
    const value = field === 'description' ? String(raw) : parseFieldValue(field, raw);
    if (value !== null && value !== undefined && value !== '') out[field] = value as string | number;
  }
  return out;
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** Field values for a brand-new photo-import card: lot defaults plus sensible fallbacks. */
export function newCardData(defaults: CardDefaults): Record<string, unknown> {
  const data: Record<string, unknown> = {
    subsetParallel: DEFAULT_SUBSET,
    conditionType: RAW_CONDITION_TYPE,
    condition: DEFAULT_RAW_CONDITION,
  };
  for (const field of DEFAULTABLE_FIELDS) {
    if (!isEmptyValue(defaults[field])) data[field] = defaults[field];
  }
  if (data.conditionType === GRADED_CONDITION_TYPE) delete data.condition;
  else delete data.grader;
  return data;
}

const CONDITION_DEPENDENT: Partial<Record<DefaultableField, 'graded' | 'raw'>> = { grader: 'graded', condition: 'raw' };

/**
 * Updates that fill a card's empty fields from the lot defaults, never overwriting what's there.
 * Condition only applies to raw cards and grader only to graded cards.
 * A stored condition that isn't one of eBay's options counts as empty.
 */
export function fillEmptyFromDefaults(card: Record<string, unknown>, defaults: CardDefaults): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  const conditionType = (card.conditionType as string | undefined) || RAW_CONDITION_TYPE;
  for (const field of DEFAULTABLE_FIELDS) {
    const value = defaults[field];
    if (isEmptyValue(value) || field === 'conditionType') continue;
    const needs = CONDITION_DEPENDENT[field];
    if (needs === 'graded' && conditionType !== GRADED_CONDITION_TYPE) continue;
    if (needs === 'raw' && conditionType === GRADED_CONDITION_TYPE) continue;
    const current = card[field];
    const invalidCondition = field === 'condition' && !(CONDITION_OPTIONS as readonly string[]).includes(String(current));
    if (isEmptyValue(current) || invalidCondition) updates[field] = value;
  }
  return updates;
}

// ─── Description templates ──────────────────────────────────────────────────

export const DESCRIPTION_TOKENS = ['{title}', '{year}', '{brand}', '{set}', '{name}', '{number}', '{parallel}', '{grader}', '{grade}', '{cert}'] as const;

interface DescriptionCard {
  title?: string | null;
  year?: number | null;
  brand?: string | null;
  setName?: string | null;
  name?: string | null;
  cardNumber?: string | null;
  subsetParallel?: string | null;
  grader?: string | null;
  grade?: string | null;
  certNo?: string | null;
  description?: string | null;
}

/** Expands {title}, {year}, … in a card's description. Plain descriptions pass through unchanged. */
export function renderDescription(card: DescriptionCard, title: string): string {
  const template = card.description?.trim() || '';
  if (!template) return '';
  const values: Record<string, string> = {
    title,
    year: card.year ? String(card.year) : '',
    brand: card.brand?.trim() || '',
    set: card.setName?.trim() || '',
    name: card.name?.trim() || '',
    number: card.cardNumber?.trim() || '',
    parallel: card.subsetParallel?.trim() || '',
    grader: card.grader ? graderShortLabel(card.grader) : '',
    grade: card.grade?.trim() || '',
    cert: card.certNo?.trim() || '',
  };
  return template.replace(/\{(title|year|brand|set|name|number|parallel|grader|grade|cert)\}/g, (_, key: string) => values[key]);
}

/** Year, Set, #Number, Name, Subset/Parallel — "Base" is left out because it adds nothing to a title. */
export function generateAutoTitle(card: DescriptionCard): string {
  const parts: string[] = [];
  if (card.year) parts.push(String(card.year));
  if (card.setName?.trim()) parts.push(card.setName.trim());
  if (card.cardNumber?.trim()) parts.push(`#${card.cardNumber.trim()}`);
  if (card.name?.trim()) parts.push(card.name.trim());
  const parallel = card.subsetParallel?.trim();
  if (parallel && parallel.toLowerCase() !== DEFAULT_SUBSET.toLowerCase()) parts.push(parallel);
  return parts.join(' ');
}

// ─── Retention ──────────────────────────────────────────────────────────────

export const COMPLETED_DELETE_DAYS = 10;
export const MAX_LOT_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** When the auto-cleanup will delete a lot. */
export function lotDeletesAt(lot: { createdAt: string | Date; completed: boolean; completedAt: string | Date | null }): Date {
  const byAge = new Date(new Date(lot.createdAt).getTime() + MAX_LOT_AGE_DAYS * DAY_MS);
  if (lot.completed && lot.completedAt) {
    const byCompletion = new Date(new Date(lot.completedAt).getTime() + COMPLETED_DELETE_DAYS * DAY_MS);
    return byCompletion < byAge ? byCompletion : byAge;
  }
  return byAge;
}

import { CardItemWithImages, CATEGORY_OPTIONS, CONDITION_OPTIONS, isPsaImportedCard } from './types';
import { GRADED_CONDITION_TYPE } from './card-fields';

const MANDATORY_FIELDS = [
  'title', 'salePrice', 'year', 'conditionType', 'category',
  'brand', 'setName', 'name', 'cardNumber', 'subsetParallel', 'description',
] as const;

export const TITLE_MAX_LENGTH = 80;

export function isCardGraded(card: { conditionType?: string | null }): boolean {
  return card.conditionType === GRADED_CONDITION_TYPE;
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number') return Number.isNaN(value);
  return false;
}

/** True when this field still needs a value before the card can be listed. */
export function isMandatoryFieldEmpty(field: string, value: unknown, card: CardItemWithImages): boolean {
  if (field === 'images') return !card.images || card.images.length === 0;
  if (field === 'grader' || field === 'grade') return isCardGraded(card) && isBlank(value);
  if (field === 'condition') {
    return !isCardGraded(card) && !(CONDITION_OPTIONS as readonly string[]).includes(String(value ?? ''));
  }
  if (field === 'subsetParallel' && isPsaImportedCard(card)) return false;
  if (!(MANDATORY_FIELDS as readonly string[]).includes(field)) return false;
  if (field === 'category') return !(CATEGORY_OPTIONS as readonly string[]).includes(String(value ?? ''));
  return isBlank(value);
}

/** Fields checked for completeness, in grid column order. */
export const COMPLETENESS_FIELDS = [
  'images', 'title', 'salePrice', 'category', 'year', 'brand', 'setName', 'cardNumber', 'name',
  'subsetParallel', 'conditionType', 'grader', 'grade', 'condition', 'description',
] as const;

export const COMPLETENESS_LABELS: Record<(typeof COMPLETENESS_FIELDS)[number], string> = {
  images: 'Photos',
  title: 'Title',
  salePrice: 'Price',
  category: 'Category',
  year: 'Year',
  brand: 'Brand',
  setName: 'Set',
  cardNumber: 'Card #',
  name: 'Name',
  subsetParallel: 'Subset/Parallel',
  conditionType: 'Graded/Raw',
  grader: 'Grader',
  grade: 'Grade',
  condition: 'Condition',
  description: 'Description',
};

/** Labels of every required field this card is still missing, in grid column order. */
export function missingFieldLabels(card: CardItemWithImages): string[] {
  const missing: string[] = COMPLETENESS_FIELDS.filter((field) => {
    const value = field === 'images' ? card.images : (card as Record<string, unknown>)[field];
    return isMandatoryFieldEmpty(field, value, card);
  }).map((field) => COMPLETENESS_LABELS[field]);
  if ((card.title ?? '').length > TITLE_MAX_LENGTH && !missing.includes('Title')) missing.push('Title (over 80 characters)');
  return missing;
}

export function firstMissingField(card: CardItemWithImages): string | null {
  for (const field of COMPLETENESS_FIELDS) {
    const value = field === 'images' ? card.images : (card as Record<string, unknown>)[field];
    if (isMandatoryFieldEmpty(field, value, card)) return field;
  }
  if ((card.title ?? '').length > TITLE_MAX_LENGTH) return 'title';
  return null;
}

export function isCardComplete(card: CardItemWithImages): boolean {
  return firstMissingField(card) === null;
}

/** Enough identity to look up sold prices: every required field is filled, and price may still be empty. */
export function isReadyForSoldComps(card: CardItemWithImages): boolean {
  const missing = missingFieldLabels(card);
  return missing.length === 0 || (missing.length === 1 && missing[0] === 'Price');
}

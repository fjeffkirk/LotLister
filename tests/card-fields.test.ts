import { describe, expect, it } from 'vitest';
import {
  CONDITION_FIELD_OPTIONS,
  DEFAULT_RAW_CONDITION,
  filterOptions,
  fillEmptyFromDefaults,
  generateAutoTitle,
  GRADED_CONDITION_TYPE,
  GRADER_FIELD_OPTIONS,
  lotDeletesAt,
  newCardData,
  parseFieldValue,
  parsePrice,
  parseYear,
  RAW_CONDITION_TYPE,
  renderDescription,
  sanitizeCardDefaults,
} from '../lib/card-fields';

describe('field parsing', () => {
  it('parses prices with dollar signs and commas, rejects junk', () => {
    expect(parsePrice('$5')).toBe(5);
    expect(parsePrice('1,299.999')).toBe(1300);
    expect(parsePrice('  ')).toBeNull();
    expect(parsePrice('five')).toBeUndefined();
    expect(parsePrice('-3')).toBeUndefined();
  });

  it('accepts realistic years only', () => {
    const now = new Date('2026-09-28');
    expect(parseYear('2023', now)).toBe(2023);
    expect(parseYear('2023-24', now)).toBe(2023);
    expect(parseYear('2028', now)).toBeUndefined();
    expect(parseYear('1700', now)).toBeUndefined();
    expect(parseYear('23', now)).toBeUndefined();
  });

  it('matches graders by their short name', () => {
    expect(parseFieldValue('grader', 'psa')).toBe('Professional Sports Authenticator (PSA)');
    expect(parseFieldValue('grader', 'BGS')).toBe('Beckett Grading Services (BGS)');
    expect(parseFieldValue('grader', 'Beckett Grading Services (BGS)')).toBe('Beckett Grading Services (BGS)');
    expect(parseFieldValue('grader', 'nobody')).toBeUndefined();
  });

  it('parses grades, condition types, conditions, and categories', () => {
    expect(parseFieldValue('grade', 'PSA 10')).toBe('10');
    expect(parseFieldValue('grade', '9.5')).toBe('9.5');
    expect(parseFieldValue('grade', '11')).toBeUndefined();
    expect(parseFieldValue('conditionType', 'raw')).toBe(RAW_CONDITION_TYPE);
    expect(parseFieldValue('conditionType', 'Graded')).toBe(GRADED_CONDITION_TYPE);
    expect(parseFieldValue('condition', 'near mint')).toBe(DEFAULT_RAW_CONDITION);
    expect(parseFieldValue('category', 'basketball')).toBe('Basketball');
    expect(parseFieldValue('category', 'pokemon')).toBe('Pokémon');
    expect(parseFieldValue('category', '')).toBeUndefined();
  });

  it('trims text fields and turns blanks into null', () => {
    expect(parseFieldValue('brand', '  Topps ')).toBe('Topps');
    expect(parseFieldValue('brand', '')).toBeNull();
    expect(parseFieldValue('images', 'x')).toBeUndefined();
  });
});

describe('filterOptions', () => {
  it('puts the popular graders first and finds them by abbreviation', () => {
    expect(GRADER_FIELD_OPTIONS.slice(0, 5).map((o) => o.label)).toEqual(['PSA', 'BGS', 'SGC', 'CGC', 'TAG']);
    expect(filterOptions(GRADER_FIELD_OPTIONS, 'psa')[0].label).toBe('PSA');
    expect(filterOptions(GRADER_FIELD_OPTIONS, 'beckett').map((o) => o.label)).toContain('BVG');
  });

  it('matches condition words anywhere', () => {
    expect(filterOptions(CONDITION_FIELD_OPTIONS, 'worn')[0].label).toBe('Poor');
  });
});

describe('lot defaults', () => {
  it('drops invalid and empty defaults', () => {
    expect(
      sanitizeCardDefaults({ year: '1999', brand: ' Topps ', grader: 'psa', category: 'nope', setName: '', salePrice: '$2' })
    ).toEqual({ year: 1999, brand: 'Topps', grader: 'Professional Sports Authenticator (PSA)', salePrice: 2 });
  });

  it('gives new cards defaults plus a valid raw condition and Base subset', () => {
    expect(newCardData({})).toEqual({
      subsetParallel: 'Base',
      conditionType: RAW_CONDITION_TYPE,
      condition: DEFAULT_RAW_CONDITION,
    });
    const graded = newCardData({ conditionType: GRADED_CONDITION_TYPE, grader: 'x', condition: DEFAULT_RAW_CONDITION, brand: 'Topps' });
    expect(graded).toMatchObject({ conditionType: GRADED_CONDITION_TYPE, grader: 'x', brand: 'Topps' });
    expect(graded).not.toHaveProperty('condition');
  });

  it('fills only empty fields and respects graded vs raw', () => {
    const defaults = { brand: 'Topps', year: 2020, grader: 'G', condition: DEFAULT_RAW_CONDITION, conditionType: GRADED_CONDITION_TYPE };
    expect(fillEmptyFromDefaults({ brand: 'Panini', year: null, conditionType: RAW_CONDITION_TYPE, condition: 'Near Mint or Better' }, defaults)).toEqual({
      year: 2020,
      condition: DEFAULT_RAW_CONDITION,
    });
    expect(fillEmptyFromDefaults({ conditionType: GRADED_CONDITION_TYPE, grader: null }, defaults)).toEqual({
      brand: 'Topps',
      year: 2020,
      grader: 'G',
    });
  });
});

describe('descriptions and titles', () => {
  const card = {
    year: 2023,
    setName: 'Topps Chrome',
    cardNumber: '12',
    name: 'Shohei Ohtani',
    subsetParallel: 'Base',
    grader: 'Professional Sports Authenticator (PSA)',
    grade: '10',
  };

  it('leaves Base out of generated titles', () => {
    expect(generateAutoTitle(card)).toBe('2023 Topps Chrome #12 Shohei Ohtani');
    expect(generateAutoTitle({ ...card, subsetParallel: 'Refractor' })).toBe('2023 Topps Chrome #12 Shohei Ohtani Refractor');
  });

  it('expands description tokens', () => {
    expect(renderDescription({ ...card, description: '{title} — {grader} {grade}. Ships fast.' }, 'T')).toBe('T — PSA 10. Ships fast.');
    expect(renderDescription({ ...card, description: 'Plain text' }, 'T')).toBe('Plain text');
    expect(renderDescription({ ...card, description: null }, 'T')).toBe('');
  });
});

describe('lotDeletesAt', () => {
  it('uses 30 days from creation, or 10 days from completion if sooner', () => {
    const createdAt = '2026-09-01T00:00:00Z';
    expect(lotDeletesAt({ createdAt, completed: false, completedAt: null }).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(lotDeletesAt({ createdAt, completed: true, completedAt: '2026-09-05T00:00:00Z' }).toISOString()).toBe(
      '2026-09-15T00:00:00.000Z'
    );
  });
});

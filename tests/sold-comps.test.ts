import { describe, expect, it } from 'vitest';
import type { CardImage, CardItem } from '@prisma/client';
import { GRADED_CONDITION_TYPE } from '../lib/card-fields';
import { isReadyForSoldComps } from '../lib/card-completeness';
import { compSearchPlans } from '../lib/sold-comps';

function card(overrides: Partial<CardItem> = {}): CardItem & { images: CardImage[] } {
  return {
    id: 'card-1',
    lotId: 'lot-1',
    title: '2026 Pokemon Captain Pikachu PSA 10',
    status: 'Draft',
    listings: null,
    salePrice: null,
    listingType: null,
    category: 'Pokémon',
    year: 2026,
    brand: 'Pokemon',
    setName: 'Chinese Gem Pack',
    name: 'Captain Pikachu',
    cardNumber: '02',
    subsetParallel: 'Base',
    attributes: null,
    team: null,
    variation: null,
    graded: true,
    grader: 'Professional Sports Authenticator (PSA)',
    grade: '10',
    conditionType: GRADED_CONDITION_TYPE,
    condition: 'Near Mint or Better',
    certNo: '171503446',
    description: 'Slab',
    psaImport: true,
    ebayItemId: null,
    ebayListedAt: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    images: [{ id: 'img', cardItemId: 'card-1', originalPath: '/a.jpg', thumbPath: '/a.jpg', filename: 'a.jpg', sortOrder: 0 }],
    ...overrides,
  };
}

describe('sold comps', () => {
  it('searches when price is the only empty required field', () => {
    expect(isReadyForSoldComps(card())).toBe(true);
    expect(isReadyForSoldComps(card({ salePrice: 40 }))).toBe(true);
    expect(isReadyForSoldComps(card({ name: '' }))).toBe(false);
  });

  it('builds an AND query that includes the grade, then a looser one', () => {
    const plans = compSearchPlans(card());
    expect(plans[0].keywords).toContain('Captain');
    expect(plans[0].keywords).toContain('PSA');
    expect(plans[0].keywords).toContain('10');
    expect(plans[0].keywords.split(',').length).toBeGreaterThan(plans.at(-1)!.keywords.split(',').length);
    expect(plans[0].phrase).not.toContain(',');
  });
});

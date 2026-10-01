import { describe, expect, it } from 'vitest';
import { etsyErrorText, etsyTags, etsyTitle, plainDescription, whenMadeFromYear } from '../lib/etsy-listing';

describe('etsy listing fields', () => {
  it('maps a card year onto an Etsy era', () => {
    expect(whenMadeFromYear(2024)).toBe('2020_2026');
    expect(whenMadeFromYear(1998)).toBe('1990s');
    expect(whenMadeFromYear(1952)).toBe('1950s');
    expect(whenMadeFromYear(null)).toBe('2020_2026');
  });

  it('keeps titles and tags inside Etsy limits', () => {
    expect(etsyTitle(`${'A'.repeat(200)}`)).toHaveLength(140);
    expect(etsyTags(['2024 Topps', 'Shohei Ohtani', 'Shohei Ohtani', 'trading card'])).toEqual([
      '2024 Topps',
      'Shohei Ohtani',
      'trading card',
    ]);
  });

  it('turns a description template into plain text and keeps the Etsy error', () => {
    expect(plainDescription('<p>PSA 10<br>Ohtani</p>', 'fallback')).toBe('PSA 10\nOhtani');
    expect(etsyErrorText(400, JSON.stringify({ error: 'Shipping profile is incomplete' }))).toBe(
      'Etsy error 400: Shipping profile is incomplete'
    );
  });
});

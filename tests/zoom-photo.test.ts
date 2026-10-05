import { describe, expect, it } from 'vitest';
import { percentWithin } from '../components/grid/ZoomPhoto';

describe('card photo zoom', () => {
  it('keeps the point under the pointer, including the edges of the photo', () => {
    const box = { left: 100, top: 40, width: 200, height: 280 };
    expect(percentWithin(100, 40, box)).toEqual({ x: 0, y: 0 });
    expect(percentWithin(200, 180, box)).toEqual({ x: 50, y: 50 });
    expect(percentWithin(300, 320, box)).toEqual({ x: 100, y: 100 });
    expect(percentWithin(0, 900, box)).toEqual({ x: 0, y: 100 });
  });
});

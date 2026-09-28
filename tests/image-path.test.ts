import path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveImagePath } from '../lib/storage';

describe('resolveImagePath', () => {
  it('resolves stored image paths inside the uploads directory', () => {
    const resolved = resolveImagePath('uploads/lot-1/card_123.jpg');
    expect(resolved.endsWith(path.join('uploads', 'lot-1', 'card_123.jpg'))).toBe(true);
  });

  it('refuses paths that climb out of the uploads directory', () => {
    for (const attempt of ['../lotlister.sqlite', 'uploads/../lotlister.sqlite', 'lot-1/../../lotlister.sqlite', '/etc/passwd']) {
      expect(() => resolveImagePath(attempt)).toThrow();
    }
  });
});

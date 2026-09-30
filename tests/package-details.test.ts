import { describe, expect, it } from 'vitest';
import { shippingPackageXml } from '../lib/ebay';

describe('lot package details', () => {
  it('sends pounds, leftover ounces, and inches for the whole lot', () => {
    const xml = shippingPackageXml({
      packageWeightOz: 20,
      packageLengthIn: 6,
      packageWidthIn: 4,
      packageHeightIn: 1,
    });
    expect(xml).toContain('<WeightMajor unit="lbs">1</WeightMajor>');
    expect(xml).toContain('<WeightMinor unit="oz">4</WeightMinor>');
    expect(xml).toContain('<PackageLength unit="in">6</PackageLength>');
    expect(xml).toContain('<PackageWidth unit="in">4</PackageWidth>');
    expect(xml).toContain('<PackageDepth unit="in">1</PackageDepth>');
  });

  it('leaves the package off the listing when a measurement is missing', () => {
    expect(shippingPackageXml({ packageWeightOz: 4, packageLengthIn: 6, packageWidthIn: 4 })).toBe('');
  });
});

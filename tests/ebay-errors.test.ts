import { describe, expect, it } from 'vitest';
import { parseAddItemResponse } from '../lib/ebay';

describe('eBay AddItem errors', () => {
  it('keeps the error code, both messages, and every value eBay named', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<AddItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Failure</Ack>
  <Errors>
    <ShortMessage>Item cannot be listed.</ShortMessage>
    <LongMessage>The item cannot be listed or modified. The title and/or description may contain improper words.</LongMessage>
    <ErrorCode>240</ErrorCode>
    <SeverityCode>Error</SeverityCode>
    <ErrorParameters ParamID="0"><Value>Shark Shredder</Value></ErrorParameters>
    <ErrorParameters ParamID="1"><Value>Title</Value></ErrorParameters>
  </Errors>
</AddItemResponse>`;
    const parsed = parseAddItemResponse(xml);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('eBay error 240:');
    expect(parsed.error).toContain('improper words');
    expect(parsed.error).toContain('eBay short message: Item cannot be listed.');
    expect(parsed.error).toContain('eBay named: Shark Shredder (parameter 0), Title (parameter 1)');
  });

  it('does not invent a flagged word when eBay sent none', () => {
    const xml = `<AddItemResponse><Ack>Failure</Ack><Errors>
      <LongMessage>Policy blocked this listing.</LongMessage>
      <ErrorCode>240</ErrorCode>
      <SeverityCode>Error</SeverityCode>
    </Errors></AddItemResponse>`;
    const parsed = parseAddItemResponse(xml);
    expect(parsed.error).toBe('eBay error 240: Policy blocked this listing.');
    expect(parsed.error).not.toMatch(/named|flagged|title/i);
  });
});

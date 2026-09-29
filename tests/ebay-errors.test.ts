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
    expect(parsed.error).toContain('eBay named: Shark Shredder, Title');
  });

  it('shows the singles-category reason once, without eBay’s HTML', () => {
    const reason =
      "It looks like you're listing multiple cards, but you have selected the Trading Cards Singles category. Please change the category to a more appropriate one. If you're listing a single card, make sure you don't use any keywords indicating multiple cards in your title.";
    const xml = `<AddItemResponse><Ack>Failure</Ack><Errors>
      <ShortMessage>The item cannot be listed or modified.</ShortMessage>
      <LongMessage>The item cannot be listed or modified. The title and/or description may contain improper words, or the listing or seller may be in violation of eBay policy.</LongMessage>
      <ErrorCode>240</ErrorCode>
      <SeverityCode>Error</SeverityCode>
      <ErrorParameters ParamID="0"><Value>&lt;font color="#757575" size="1"&gt;(e300491-1225589x)&lt;/font&gt;</Value></ErrorParameters>
      <ErrorParameters ParamID="1"><Value>${reason}</Value></ErrorParameters>
      <ErrorParameters ParamID="2"><Value>LP_SBM_Miscat_Trading_Cards_in_single_cat</Value></ErrorParameters>
      <ErrorParameters ParamID="3"><Value>1225589</Value></ErrorParameters>
      <ErrorParameters ParamID="4"><Value>&lt;font color="#757575" size="1"&gt;${reason}&lt;/font&gt;</Value></ErrorParameters>
    </Errors></AddItemResponse>`;
    const parsed = parseAddItemResponse(xml);
    expect(parsed.error).toBe(`eBay error 240: ${reason}`);
    expect(parsed.error).not.toMatch(/font|parameter|LP_SBM|improper words/i);
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

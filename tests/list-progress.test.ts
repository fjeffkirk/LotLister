import { describe, expect, it } from 'vitest';
import { applyListEvent, readListEvents, type ListRun } from '../lib/list-progress';

const start: ListRun = {
  phase: 'saving',
  detail: 'Saving the latest card changes',
  total: 2,
  skippedNotReady: 0,
  skippedAlreadyListed: 0,
  remainingReady: 0,
  items: [
    { cardId: 'a', title: 'Old title', format: 'Buy Now', price: 10, category: 'Pokémon', status: 'waiting' },
  ],
};

describe('listing progress events', () => {
  it('replaces the queue with the cards eBay is about to receive', () => {
    const next = applyListEvent(start, {
      type: 'start',
      total: 2,
      skippedNotReady: 1,
      skippedAlreadyListed: 3,
      remainingReady: 0,
      cards: [
        { cardId: 'a', title: 'Pikachu PSA 10', format: 'Buy Now', price: 42, category: 'Pokémon' },
        { cardId: 'b', title: 'Judge Auction', format: 'Auction', price: 0.99, category: 'Baseball' },
      ],
    });
    expect(next.phase).toBe('running');
    expect(next.items.map((item) => item.title)).toEqual(['Pikachu PSA 10', 'Judge Auction']);
    expect(next.items.every((item) => item.status === 'waiting')).toBe(true);
    expect(next.skippedNotReady).toBe(1);
  });

  it('marks the card being sent, then records the eBay result', () => {
    const queued = applyListEvent(start, {
      type: 'start',
      total: 1,
      skippedNotReady: 0,
      skippedAlreadyListed: 0,
      remainingReady: 0,
      cards: [{ cardId: 'a', title: 'Pikachu PSA 10', format: 'Buy Now', price: 42, category: 'Pokémon' }],
    });
    const sending = applyListEvent(queued, { type: 'sending', cardId: 'a', index: 1, total: 1 });
    expect(sending.detail).toContain('Pikachu PSA 10');
    expect(sending.items[0].status).toBe('sending');

    const listed = applyListEvent(sending, {
      type: 'result',
      index: 1,
      total: 1,
      result: { cardId: 'a', title: 'Pikachu PSA 10', success: true, listingUrl: 'https://www.ebay.com/itm/1' },
    });
    expect(listed.items[0].status).toBe('listed');
    expect(listed.items[0].listingUrl).toContain('ebay.com');

    const done = applyListEvent(listed, {
      type: 'done',
      summary: {
        listedCount: 1,
        failedCount: 0,
        skippedNotReady: 0,
        skippedAlreadyListed: 0,
        remainingReady: 0,
        results: [{ cardId: 'a', title: 'Pikachu PSA 10', success: true }],
      },
    });
    expect(done.phase).toBe('done');
    expect(done.detail).toBe('1 card is on eBay');
  });

  it('reads events split across chunks', async () => {
    const events = [
      JSON.stringify({ type: 'sending', cardId: 'a', index: 1, total: 1 }),
      JSON.stringify({ type: 'error', error: 'eBay timed out' }),
    ].join('\n');
    const seen: string[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(events);
        controller.enqueue(bytes.slice(0, 12));
        controller.enqueue(bytes.slice(12));
        controller.close();
      },
    });
    await readListEvents(stream, (event) => seen.push(event.type));
    expect(seen).toEqual(['sending', 'error']);
  });
});

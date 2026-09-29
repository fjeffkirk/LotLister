export interface ListEventResult {
  cardId: string;
  title: string;
  success: boolean;
  listingUrl?: string;
  error?: string;
}

export interface ListEventSummary {
  listedCount: number;
  failedCount: number;
  skippedNotReady: number;
  skippedAlreadyListed: number;
  remainingReady: number;
  results: ListEventResult[];
}

export interface EbayListQueueCard {
  cardId: string;
  title: string;
  format: 'Auction' | 'Buy Now';
  price: number | null;
  category: string;
}

export type EbayListEvent =
  | {
      type: 'start';
      total: number;
      skippedNotReady: number;
      skippedAlreadyListed: number;
      remainingReady: number;
      cards: EbayListQueueCard[];
    }
  | { type: 'sending'; cardId: string; index: number; total: number }
  | { type: 'result'; index: number; total: number; result: ListEventResult }
  | { type: 'done'; summary: ListEventSummary }
  | { type: 'error'; error: string };

export interface ListProgressItem {
  cardId: string;
  title: string;
  format: string;
  price: number | null;
  category: string;
  status: 'waiting' | 'sending' | 'listed' | 'failed';
  error?: string;
  listingUrl?: string;
}

export interface ListRun {
  phase: 'saving' | 'running' | 'done' | 'error';
  detail: string;
  total: number;
  skippedNotReady: number;
  skippedAlreadyListed: number;
  remainingReady: number;
  items: ListProgressItem[];
}

export function applyListEvent(run: ListRun, event: EbayListEvent): ListRun {
  if (event.type === 'error') {
    return { ...run, phase: 'error', detail: event.error };
  }

  if (event.type === 'start') {
    const total = event.total;
    return {
      ...run,
      phase: 'running',
      detail: total === 1 ? 'Sending 1 card to eBay' : `Sending ${total} cards to eBay`,
      total,
      skippedNotReady: event.skippedNotReady,
      skippedAlreadyListed: event.skippedAlreadyListed,
      remainingReady: event.remainingReady,
      items: event.cards.map((card) => ({ ...card, status: 'waiting' })),
    };
  }

  if (event.type === 'sending') {
    const current = run.items.find((item) => item.cardId === event.cardId);
    return {
      ...run,
      phase: 'running',
      detail: `Sending ${event.index} of ${event.total}${current ? ` · ${current.title}` : ''}`,
      items: run.items.map((item) =>
        item.cardId === event.cardId ? { ...item, status: 'sending' } : item
      ),
    };
  }

  if (event.type === 'result') {
    const items = run.items.some((item) => item.cardId === event.result.cardId)
      ? run.items.map((item) =>
          item.cardId === event.result.cardId
            ? {
                ...item,
                title: event.result.title || item.title,
                status: event.result.success ? ('listed' as const) : ('failed' as const),
                error: event.result.error,
                listingUrl: event.result.listingUrl,
              }
            : item
        )
      : [
          ...run.items,
          {
            cardId: event.result.cardId,
            title: event.result.title,
            format: '',
            price: null,
            category: '',
            status: event.result.success ? ('listed' as const) : ('failed' as const),
            error: event.result.error,
            listingUrl: event.result.listingUrl,
          },
        ];
    const finished = items.filter((item) => item.status === 'listed' || item.status === 'failed').length;
    const failed = items.filter((item) => item.status === 'failed').length;
    return {
      ...run,
      phase: 'running',
      detail: `Finished ${finished} of ${event.total}${failed > 0 ? ` · ${failed} failed` : ''}`,
      items,
    };
  }

  const listed = event.summary.listedCount;
  const failed = event.summary.failedCount;
  return {
    ...run,
    phase: 'done',
    detail:
      failed === 0
        ? `${listed} ${listed === 1 ? 'card is' : 'cards are'} on eBay`
        : `Listed ${listed} · ${failed} failed`,
    total: event.summary.results.length,
    skippedNotReady: event.summary.skippedNotReady,
    skippedAlreadyListed: event.summary.skippedAlreadyListed,
    remainingReady: event.summary.remainingReady,
  };
}

/** Reads a newline-delimited JSON body and applies each event. */
export async function readListEvents(
  body: ReadableStream<Uint8Array> | null,
  onEvent: (event: EbayListEvent) => void
): Promise<void> {
  if (!body) throw new Error('No response from the server');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const take = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    onEvent(JSON.parse(trimmed) as EbayListEvent);
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) take(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) take(buffer);
}

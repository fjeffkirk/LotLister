import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-28T18:00:00.000Z');

const prismaMock = {
  ebayConnection: { findUnique: vi.fn() },
  cardItem: { findMany: vi.fn() },
  ebayItemPlayer: { findMany: vi.fn(), upsert: vi.fn() },
};
const tradingCall = vi.fn();

vi.mock('../lib/prisma', () => ({ default: prismaMock }));
vi.mock('../lib/ebay', () => ({
  getEbayCredentials: vi.fn(async () => ({ appId: 'a', devId: 'd', certId: 'c', ruName: 'r' })),
  getValidEbayAccessToken: vi.fn(async () => 'user-token'),
  tradingCall,
  decodeXml: (value: string) => value.replace(/&amp;/g, '&'),
}));

const { getDashboardData } = await import('../lib/ebay-dashboard');

function iso(daysAgo: number): string {
  return new Date(NOW - daysAgo * DAY).toISOString();
}

function order(id: string, daysAgo: number, lines: { itemId: string; cost: number; qty?: number }[], extra: object = {}) {
  const itemTotal = lines.reduce((sum, line) => sum + line.cost, 0);
  return {
    orderId: id,
    creationDate: iso(daysAgo),
    orderPaymentStatus: 'PAID',
    orderFulfillmentStatus: 'FULFILLED',
    cancelStatus: { cancelState: 'NONE_REQUESTED' },
    totalFeeBasisAmount: { value: String(itemTotal + 4) },
    totalMarketplaceFee: { value: '2.00' },
    paymentSummary: { refunds: [] },
    lineItems: lines.map((line) => ({
      legacyItemId: line.itemId,
      title: `Card ${line.itemId}`,
      quantity: line.qty ?? 1,
      lineItemCost: { value: String(line.cost) },
    })),
    ...extra,
  };
}

const SOLD_ORDERS = [
  order('o1', 1, [{ itemId: '101', cost: 20 }]),
  order('o2', 10, [{ itemId: '102', cost: 50 }, { itemId: '103', cost: 10, qty: 2 }]),
  order('o3', 60, [{ itemId: '101', cost: 30 }], {
    orderPaymentStatus: 'PARTIALLY_REFUNDED',
    paymentSummary: { refunds: [{ refundStatus: 'REFUNDED', amount: { value: '5.00' } }] },
  }),
  order('canceled', 2, [{ itemId: '104', cost: 999 }], { cancelStatus: { cancelState: 'CANCELED' } }),
  order('refunded', 3, [{ itemId: '104', cost: 999 }], { orderPaymentStatus: 'FULLY_REFUNDED' }),
];

const AWAITING_ORDERS = [
  {
    ...order('s1', 1, [{ itemId: '101', cost: 20 }]),
    orderFulfillmentStatus: 'NOT_STARTED',
    lineItems: [
      {
        legacyItemId: '101',
        quantity: 1,
        lineItemCost: { value: '20' },
        lineItemFulfillmentStatus: 'NOT_STARTED',
        lineItemFulfillmentInstructions: { shipByDate: iso(-2) },
      },
    ],
  },
  {
    ...order('s2', 5, [{ itemId: '102', cost: 50 }]),
    orderFulfillmentStatus: 'NOT_STARTED',
    lineItems: [
      {
        legacyItemId: '102',
        quantity: 3,
        lineItemCost: { value: '50' },
        lineItemFulfillmentStatus: 'NOT_STARTED',
        lineItemFulfillmentInstructions: { shipByDate: iso(1) },
      },
    ],
  },
];

const SELLING_XML = `<?xml version="1.0"?><GetMyeBaySellingResponse><Ack>Success</Ack>
<ActiveList><ItemArray>
  <Item><ItemID>1</ItemID><SellingStatus><CurrentPrice currencyID="USD">12.50</CurrentPrice></SellingStatus><QuantityAvailable>1</QuantityAvailable><WatchCount>3</WatchCount></Item>
  <Item><ItemID>2</ItemID><SellingStatus><CurrentPrice currencyID="USD">5.00</CurrentPrice></SellingStatus><QuantityAvailable>2</QuantityAvailable></Item>
</ItemArray><PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages><TotalNumberOfEntries>2</TotalNumberOfEntries></PaginationResult></ActiveList>
<ScheduledList><PaginationResult><TotalNumberOfPages>4</TotalNumberOfPages><TotalNumberOfEntries>4</TotalNumberOfEntries></PaginationResult></ScheduledList>
</GetMyeBaySellingResponse>`;

function getItemXml(player: string | null): string {
  const specific = player ? `<NameValueList><Name>Player/Athlete</Name><Value>${player}</Value></NameValueList>` : '';
  return `<GetItemResponse><Ack>Success</Ack><Item><ItemSpecifics>${specific}<NameValueList><Name>Sport</Name><Value>Baseball</Value></NameValueList></ItemSpecifics></Item></GetItemResponse>`;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('getDashboardData', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    prismaMock.ebayConnection.findUnique.mockResolvedValue({ userEmail: 'u1', ebayUsername: 'seller1' });
    prismaMock.cardItem.findMany.mockResolvedValue([{ ebayItemId: '101', name: 'Shohei Ohtani' }]);
    prismaMock.ebayItemPlayer.findMany.mockResolvedValue([{ itemId: '103', player: 'Mike Trout' }]);
    prismaMock.ebayItemPlayer.upsert.mockResolvedValue({});
    tradingCall.mockImplementation(async (_creds: unknown, _token: string, callName: string, xml: string) => {
      if (callName === 'GetMyeBaySelling') return { status: 200, text: SELLING_XML };
      if (callName === 'GetItem' && xml.includes('<ItemID>102</ItemID>')) return { status: 200, text: getItemXml('Mike Trout') };
      return { status: 200, text: getItemXml(null) };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('adds up sales, fees, shipping, listings, and best-selling players per range', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('orderfulfillmentstatus')) return jsonResponse(200, { orders: AWAITING_ORDERS, total: 2 });
      return jsonResponse(200, { orders: SOLD_ORDERS, total: SOLD_ORDERS.length });
    });
    vi.stubGlobal('fetch', fetchMock);

    const data = await getDashboardData('u1', 0);

    expect(data.state).toBe('ok');
    expect(data.account).toBe('seller1');
    expect(fetchMock.mock.calls[0][0]).toContain(`creationdate:%5B${iso(90)}..%5D`);

    if (data.sales.status !== 'ok') throw new Error('sales not ok');
    const { ranges, recent, pendingLookups } = data.sales.data;

    expect(ranges['7'].summary).toMatchObject({ gross: 24, fees: 2, net: 22, orders: 1, units: 1, avgItemPrice: 20 });
    expect(ranges['30'].summary).toMatchObject({ gross: 88, fees: 4, net: 84, orders: 2, units: 4, avgItemPrice: 20 });
    expect(ranges['90'].summary).toMatchObject({ gross: 122, fees: 6, refunds: 5, net: 111, orders: 3, units: 5 });
    expect(ranges['7'].summary.daily).toHaveLength(7);
    expect(ranges['7'].summary.daily[5]).toBe(24);

    expect(ranges['30'].players).toEqual([
      { name: 'Mike Trout', units: 3, revenue: 60 },
      { name: 'Shohei Ohtani', units: 1, revenue: 20 },
    ]);
    expect(ranges['90'].players[1]).toEqual({ name: 'Shohei Ohtani', units: 2, revenue: 50 });
    expect(pendingLookups).toBe(0);
    expect(recent[0]).toMatchObject({ itemId: '101', price: 20, player: 'Shohei Ohtani' });
    expect(recent.some((sale) => sale.price === 999)).toBe(false);

    const lookedUp = tradingCall.mock.calls.filter((call) => call[2] === 'GetItem');
    expect(lookedUp).toHaveLength(1);
    expect(prismaMock.ebayItemPlayer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { itemId: '102' }, create: { itemId: '102', player: 'Mike Trout' } })
    );

    expect(data.shipping).toEqual({
      status: 'ok',
      data: { orders: 2, units: 4, overdue: 1, nextShipBy: iso(-2) },
    });
    expect(data.listings).toEqual({ status: 'ok', data: { count: 2, value: 22.5, watchers: 3, scheduled: 4 } });
  });

  it('asks for a reconnect when the token lacks the orders scope, but still shows listings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(403, { errors: [{ message: 'Insufficient permissions' }] })));

    const data = await getDashboardData('u1', 0);

    expect(data.sales.status).toBe('reconnect');
    expect(data.shipping.status).toBe('reconnect');
    expect(data.listings.status).toBe('ok');
  });

  it('reports a missing eBay connection without calling eBay', async () => {
    prismaMock.ebayConnection.findUnique.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const data = await getDashboardData('u1', 0);

    expect(data.state).toBe('not_connected');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tradingCall).not.toHaveBeenCalled();
  });
});

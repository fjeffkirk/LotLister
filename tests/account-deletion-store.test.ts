import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createPrismaDeletionStore } from '../lib/ebay-account-deletion';

type Connection = { userEmail: string; ebayUserId: string | null; ebayUsername: string | null };
type Lot = { id: string; userEmail: string };
type Card = { id: string; lotId: string };
type Notification = { notificationId: string; connectionsDeleted: number; lotsDeleted: number; cardsCleared: number };

// In-memory stand-in for the Prisma client so the real deletion logic runs without touching a database.
function fakePrisma(seed: { connections: Connection[]; users: string[]; lots: Lot[]; cards: Card[] }) {
  const state = {
    connections: seed.connections.map((c) => ({ ...c })),
    users: [...seed.users],
    lots: seed.lots.map((l) => ({ ...l })),
    cards: seed.cards.map((c) => ({ ...c })),
    notifications: [] as Notification[],
  };

  const tx = {
    ebayDeletionNotification: {
      findUnique: async ({ where }: { where: { notificationId: string } }) =>
        state.notifications.find((n) => n.notificationId === where.notificationId) ?? null,
      create: async ({ data }: { data: Notification }) => {
        if (state.notifications.some((n) => n.notificationId === data.notificationId)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        state.notifications.push(data);
        return data;
      },
    },
    ebayConnection: {
      findMany: async ({ where }: { where: { OR: Record<string, { in: string[] }>[] } }) => {
        const ids = where.OR[0].ebayUserId.in;
        return state.connections
          .filter((c) => ids.includes(c.ebayUserId ?? '') || ids.includes(c.ebayUsername ?? ''))
          .map((c) => ({ userEmail: c.userEmail }));
      },
      deleteMany: async ({ where }: { where: { userEmail: { in: string[] } } }) => {
        const before = state.connections.length;
        state.connections = state.connections.filter((c) => !where.userEmail.in.includes(c.userEmail));
        return { count: before - state.connections.length };
      },
    },
    lot: {
      findMany: async ({ where }: { where: { userEmail: { in: string[] } } }) =>
        state.lots.filter((l) => where.userEmail.in.includes(l.userEmail)).map((l) => ({ id: l.id })),
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        const before = state.lots.length;
        state.lots = state.lots.filter((l) => !where.id.in.includes(l.id));
        state.cards = state.cards.filter((c) => !where.id.in.includes(c.lotId));
        return { count: before - state.lots.length };
      },
    },
    cardItem: {
      count: async ({ where }: { where: { lotId: { in: string[] } } }) =>
        state.cards.filter((c) => where.lotId.in.includes(c.lotId)).length,
    },
    user: {
      deleteMany: async ({ where }: { where: { email: { in: string[] } } }) => {
        const before = state.users.length;
        state.users = state.users.filter((u) => !where.email.in.includes(u));
        return { count: before - state.users.length };
      },
    },
  };

  const client = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  return { client: client as unknown as PrismaClient, state };
}

const seed = () =>
  fakePrisma({
    connections: [
      { userEmail: 'ma8vp1jySJC', ebayUserId: 'ma8vp1jySJC', ebayUsername: 'test_user' },
      { userEmail: 'friendId', ebayUserId: 'friendId', ebayUsername: 'friend_user' },
    ],
    users: ['ma8vp1jySJC', 'friendId'],
    lots: [
      { id: 'lot-mine', userEmail: 'ma8vp1jySJC' },
      { id: 'lot-friend', userEmail: 'friendId' },
    ],
    cards: [
      { id: 'c1', lotId: 'lot-mine' },
      { id: 'c2', lotId: 'lot-mine' },
      { id: 'c3', lotId: 'lot-friend' },
    ],
  });

describe('createPrismaDeletionStore', () => {
  it('deletes the whole LotLister account for that eBay user and nobody else’s', async () => {
    const { client, state } = seed();
    const deleteFiles = vi.fn(async () => undefined);

    const outcome = await createPrismaDeletionStore(client, deleteFiles).deleteEbayUserData({
      notificationId: 'n-1',
      userId: 'ma8vp1jySJC',
      username: 'test_user',
    });

    expect(outcome).toEqual({ duplicate: false, connectionsDeleted: 1, lotsDeleted: 1, cardsCleared: 2 });
    expect(state.connections.map((c) => c.userEmail)).toEqual(['friendId']);
    expect(state.users).toEqual(['friendId']);
    expect(state.lots.map((l) => l.id)).toEqual(['lot-friend']);
    expect(state.cards.map((c) => c.id)).toEqual(['c3']);
    expect(deleteFiles).toHaveBeenCalledTimes(1);
    expect(deleteFiles).toHaveBeenCalledWith('lot-mine');
    expect(state.notifications).toEqual([
      { notificationId: 'n-1', connectionsDeleted: 1, lotsDeleted: 1, cardsCleared: 2 },
    ]);
  });

  it('matches on username when the stored user id is missing', async () => {
    const { client, state } = fakePrisma({
      connections: [{ userEmail: 'acct-1', ebayUserId: null, ebayUsername: 'test_user' }],
      users: ['acct-1'],
      lots: [{ id: 'lot-1', userEmail: 'acct-1' }],
      cards: [],
    });
    const outcome = await createPrismaDeletionStore(client).deleteEbayUserData({
      notificationId: 'n-2',
      userId: 'ma8vp1jySJC',
      username: 'test_user',
    });
    expect(outcome.connectionsDeleted).toBe(1);
    expect(outcome.lotsDeleted).toBe(1);
    expect(state.connections).toHaveLength(0);
    expect(state.users).toHaveLength(0);
  });

  it('treats a retried notification as already processed', async () => {
    const { client, state } = seed();
    const deleteFiles = vi.fn(async () => undefined);
    const store = createPrismaDeletionStore(client, deleteFiles);
    const request = { notificationId: 'n-3', userId: 'ma8vp1jySJC', username: 'test_user' };

    await store.deleteEbayUserData(request);
    const second = await store.deleteEbayUserData(request);

    expect(second).toEqual({ duplicate: true, connectionsDeleted: 0, lotsDeleted: 0, cardsCleared: 0 });
    expect(state.notifications).toHaveLength(1);
    expect(deleteFiles).toHaveBeenCalledTimes(1);
  });

  it('treats a concurrent duplicate that hits the unique key as already processed', async () => {
    const { client, state } = seed();
    state.notifications.push({ notificationId: 'n-race', connectionsDeleted: 0, lotsDeleted: 0, cardsCleared: 0 });
    const tx = (client as unknown as { $transaction: (fn: (t: unknown) => unknown) => unknown }).$transaction;
    const racing = {
      $transaction: (fn: (t: unknown) => unknown) =>
        tx((t: unknown) => {
          const inner = t as { ebayDeletionNotification: { findUnique: () => Promise<null> } };
          inner.ebayDeletionNotification.findUnique = async () => null;
          return fn(t);
        }),
    } as unknown as PrismaClient;

    const outcome = await createPrismaDeletionStore(racing).deleteEbayUserData({
      notificationId: 'n-race',
      userId: 'friendId',
      username: 'friend_user',
    });
    expect(outcome.duplicate).toBe(true);
  });

  it('succeeds and records the notification when LotLister stores nothing for the user', async () => {
    const { client, state } = seed();
    const outcome = await createPrismaDeletionStore(client).deleteEbayUserData({
      notificationId: 'n-4',
      userId: 'unknownUser',
      username: 'unknown_user',
    });

    expect(outcome).toEqual({ duplicate: false, connectionsDeleted: 0, lotsDeleted: 0, cardsCleared: 0 });
    expect(state.connections).toHaveLength(2);
    expect(state.lots).toHaveLength(2);
    expect(state.notifications).toHaveLength(1);
  });
});

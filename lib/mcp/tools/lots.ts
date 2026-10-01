import { z } from 'zod';
import prisma from '../../prisma';
import { isCardComplete } from '../../card-completeness';
import { registerTool } from '../registry';

const lotIdSchema = z.object({ lotId: z.string().uuid() });

registerTool({
  name: 'lots_list',
  description: 'List this account’s lots, with how many cards are ready, listed on eBay, and drafted nowhere. Read only.',
  effect: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async handler(ctx) {
    const lots = await prisma.lot.findMany({
      where: { userEmail: ctx.accountId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: {
        cardItems: { include: { images: { take: 1 } } },
      },
    });
    return lots.map((lot) => {
      const cards = lot.cardItems;
      return {
        id: lot.id,
        name: lot.name,
        completed: lot.completed,
        updatedAt: lot.updatedAt.toISOString(),
        cards: cards.length,
        ready: cards.filter((card) => !card.ebayItemId && isCardComplete(card)).length,
        listedOnEbay: cards.filter((card) => card.ebayItemId).length,
        listedOnEtsy: cards.filter((card) => card.etsyListingId).length,
      };
    });
  },
});

registerTool({
  name: 'lots_get',
  description: 'Read one lot and its cards: title, price, category, and whether each card is already on eBay or Etsy. Does not change anything.',
  effect: 'read',
  inputSchema: {
    type: 'object',
    properties: { lotId: { type: 'string', description: 'Lot id from lots_list' } },
    required: ['lotId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const { lotId } = lotIdSchema.parse(args);
    const lot = await prisma.lot.findFirst({
      where: { id: lotId, userEmail: ctx.accountId },
      include: {
        cardItems: { orderBy: { sortOrder: 'asc' }, take: 100, include: { images: { take: 1 } } },
      },
    });
    if (!lot) throw new Error('Lot not found');
    return {
      id: lot.id,
      name: lot.name,
      completed: lot.completed,
      cards: lot.cardItems.map((card) => ({
        id: card.id,
        title: card.title,
        name: card.name,
        price: card.salePrice,
        category: card.category,
        year: card.year,
        status: card.status,
        hasPhoto: card.images.length > 0,
        ebayItemId: card.ebayItemId,
        etsyListingId: card.etsyListingId,
        ready: isCardComplete(card),
      })),
    };
  },
});

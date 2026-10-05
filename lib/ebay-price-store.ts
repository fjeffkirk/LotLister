import { randomBytes } from 'crypto';
import prisma from './prisma';
import type { PriceChange } from './ebay-price';
import type { PriceLineStore, StoredPriceLine } from './ebay-price-apply';

function toLine(row: {
  id: string;
  previewId: string;
  itemId: string;
  variationSku: string;
  listingSku: string | null;
  title: string;
  currency: string;
  originalCents: number;
  proposedCents: number;
  status: string;
  reason: string | null;
  verifiedCents: number | null;
}): StoredPriceLine {
  return {
    id: row.id,
    previewId: row.previewId,
    itemId: row.itemId,
    variationSku: row.variationSku || null,
    listingSku: row.listingSku,
    title: row.title,
    currency: row.currency,
    originalPrice: row.originalCents / 100,
    proposedPrice: row.proposedCents / 100,
    originalCents: row.originalCents,
    proposedCents: row.proposedCents,
    status: row.status as StoredPriceLine['status'],
    reason: row.reason,
    verifiedCents: row.verifiedCents,
  };
}

export function newPreviewId(): string {
  return `price_${randomBytes(12).toString('hex')}`;
}

export function prismaPriceStore(): PriceLineStore {
  return {
    async create(userEmail, previewId, changes: PriceChange[]) {
      if (changes.length === 0) return;
      await prisma.ebayPricePreviewLine.createMany({
        data: changes.map((change) => ({
          id: `line_${randomBytes(8).toString('hex')}`,
          previewId,
          userEmail,
          itemId: change.itemId,
          variationSku: change.variationSku ?? '',
          listingSku: change.listingSku,
          title: change.title,
          currency: change.currency,
          originalCents: change.originalCents,
          proposedCents: change.proposedCents,
          status: 'pending',
        })),
      });
    },
    async list(previewId, userEmail) {
      const rows = await prisma.ebayPricePreviewLine.findMany({
        where: { previewId, userEmail },
        orderBy: { createdAt: 'asc' },
      });
      if (rows.length === 0) {
        const other = await prisma.ebayPricePreviewLine.findFirst({ where: { previewId }, select: { id: true } });
        return other ? null : [];
      }
      return rows.map(toLine);
    },
    async claim(id) {
      const staleLock = new Date(Date.now() - 120_000);
      const claimed = await prisma.ebayPricePreviewLine.updateMany({
        where: {
          id,
          OR: [
            { status: { in: ['pending', 'failed'] } },
            { status: 'applying', updatedAt: { lt: staleLock } },
          ],
        },
        data: { status: 'applying', reason: null },
      });
      return claimed.count === 1;
    },
    async finish(id, status, reason, verifiedCents) {
      await prisma.ebayPricePreviewLine.update({
        where: { id },
        data: { status, reason, verifiedCents: verifiedCents ?? null },
      });
    },
  };
}

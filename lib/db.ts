import { PrismaClient } from '@prisma/client';
import { env } from './env';
import { log } from './logger';
import client from './prisma';

/**
 * StockPilot code uses a nullable client so Shopify pages keep rendering when
 * Postgres is briefly unreachable. LotLister listing routes import prisma.ts directly.
 */
export const prisma: PrismaClient | null = env.databaseConfigured ? client : null;

export async function tryPrisma<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T | null> {
  if (!prisma) return null;
  try {
    return await fn(prisma);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('Database query skipped (unreachable or error)', { message: message.slice(0, 200) });
    return null;
  }
}

export async function safeQuery<T>(fallback: T, fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  const result = await tryPrisma(fn);
  return result === null ? fallback : result;
}

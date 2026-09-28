import { NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { getUserEmail } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

const SUGGESTION_FIELDS = ['brand', 'setName', 'name', 'team', 'subsetParallel'] as const;
type SuggestionField = (typeof SUGGESTION_FIELDS)[number];
const LIMIT_PER_FIELD = 400;

// GET /api/suggestions - Distinct values the user has already entered, most recent first, for autocomplete
export async function GET(): Promise<
  NextResponse<{ success: boolean; data?: Record<SuggestionField, string[]>; error?: string }>
> {
  const userEmail = await getUserEmail();
  if (!userEmail) {
    return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 });
  }

  try {
    const entries = await Promise.all(
      SUGGESTION_FIELDS.map(async (field) => {
        const rows = await prisma.cardItem.findMany({
          where: { lot: { userEmail }, [field]: { not: null } },
          distinct: [field],
          select: { [field]: true },
          orderBy: { updatedAt: 'desc' },
          take: LIMIT_PER_FIELD,
        });
        const values = rows
          .map((row) => String((row as Record<string, unknown>)[field] ?? '').trim())
          .filter(Boolean);
        return [field, [...new Set(values)]] as const;
      })
    );
    return NextResponse.json({ success: true, data: Object.fromEntries(entries) as Record<SuggestionField, string[]> });
  } catch (error) {
    console.error('Failed to load suggestions:', error);
    return NextResponse.json({ success: false, error: 'Failed to load suggestions' }, { status: 500 });
  }
}

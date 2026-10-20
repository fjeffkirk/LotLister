import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserEmail } from '../../../../lib/auth';
import { tiktokError, tiktokJson } from '../../../../lib/tiktok/http';
import { savePolicyFromUser } from '../../../../lib/tiktok/service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  advertiserId: z.string().regex(/^\d{4,30}$/),
  dailyBudgetUsd: z.number().positive().max(100000),
  authorizePeak: z.boolean(),
  targetCpaUsd: z.number().positive().max(10000),
  observationHours: z.number().int().min(24).max(24 * 30),
  reportingDelayHours: z.number().int().min(1).max(72),
  minPurchasesBeforePause: z.number().int().min(1).max(1000),
  scheduledReviewEnabled: z.boolean(),
  safetyRulesEnabled: z.boolean(),
  totalTestCapUsd: z.number().positive().max(1000000).nullable(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
}).strict();

export async function POST(request: NextRequest) {
  const accountId = await getUserEmail();
  if (!accountId) return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 });
  try {
    const body = bodySchema.parse(await request.json());
    return tiktokJson(await savePolicyFromUser(accountId, body));
  } catch (error) {
    return tiktokError(error);
  }
}

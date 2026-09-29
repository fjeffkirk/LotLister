import { NextResponse } from "next/server";
import { isUnauthorized, requireSession } from "@/lib/require-session";
import { toZonedTime } from "date-fns-tz";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { revalidateAppData } from "@/lib/sync/revalidate";

const TZ = "America/New_York";

/** YYYY-MM-DD in the app's local timezone */
function todayLocalStr(): string {
  const z = toZonedTime(new Date(), TZ);
  const y = z.getFullYear();
  const m = String(z.getMonth() + 1).padStart(2, "0");
  const d = String(z.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const saveSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  amount: z.number().min(0, "amount must be >= 0"),
});

/** POST /api/ad-budget — upsert an ad budget entry for a date */
export async function POST(request: Request) {
  const session = await requireSession();
  if (isUnauthorized(session)) return session;
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { date, amount } = parsed.data;
  // Store as UTC midnight so the DATE column is unambiguous
  const day = new Date(date + "T00:00:00.000Z");
  const todayUtc = new Date(todayLocalStr() + "T00:00:00.000Z");

  try {
    // ── Retroactive-edit fence ──────────────────────────────────────────────
    // If the user is editing a PAST date, the carry-forward would bleed into
    // today (and beyond) unless we pin today's value first.
    // Rule: only editing TODAY or a future date should affect future carry-forward.
    if (day < todayUtc) {
      // Is there already an explicit entry anywhere between this date and today?
      // If yes, that entry already acts as a natural fence — no action needed.
      const existingFence = await prisma.dailyAdBudget.findFirst({
        where: { date: { gt: day, lte: todayUtc } },
        orderBy: { date: "asc" },
      });

      if (!existingFence) {
        // No fence exists. Find what today's effective budget currently is
        // (the carry-forward from BEFORE this retroactive edit, i.e. the most
        // recent entry strictly before the date being edited).
        const prevEntry = await prisma.dailyAdBudget.findFirst({
          where: { date: { lt: day } },
          orderBy: { date: "desc" },
          select: { amount: true },
        });

        // Pin today at whatever the carry-forward was. If no prior entry existed,
        // today had no budget ($0) — keep it that way.
        await prisma.dailyAdBudget.upsert({
          where: { date: todayUtc },
          // If today was somehow already set between our check and now, don't overwrite it.
          update: {},
          create: { date: todayUtc, amount: prevEntry?.amount ?? 0 },
        });
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    const entry = await prisma.dailyAdBudget.upsert({
      where: { date: day },
      update: { amount, updatedAt: new Date() },
      create: { date: day, amount },
    });
    revalidateAppData();
    return NextResponse.json({ ok: true, entry });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** GET /api/ad-budget — return the 30 most recent entries */
export async function GET() {
  if (!prisma) return NextResponse.json({ entries: [] });
  const entries = await prisma.dailyAdBudget.findMany({
    orderBy: { date: "desc" },
    take: 30,
  });
  return NextResponse.json({ entries });
}

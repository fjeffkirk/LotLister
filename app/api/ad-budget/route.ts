import { NextResponse } from "next/server";
import { isUnauthorized, requireSession } from "@/lib/require-session";
import { toZonedTime } from "date-fns-tz";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { revalidateAppData } from "@/lib/sync/revalidate";
import { adBudgetWrites, effectiveAdAmount, type AdBudgetPoint } from "@/lib/ad-budget";
import { toNumber } from "@/lib/money";

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
  const today = todayLocalStr();
  if (date > today) {
    return NextResponse.json({ error: "Pick today or an earlier day." }, { status: 400 });
  }

  try {
    const existing = await prisma.dailyAdBudget.findMany({
      where: { date: { lte: new Date(today + "T00:00:00.000Z") } },
      orderBy: { date: "asc" },
      select: { date: true, amount: true },
    });
    const points: AdBudgetPoint[] = existing.map((entry) => ({
      date: entry.date.toISOString().slice(0, 10),
      amount: toNumber(entry.amount),
    }));
    const writes = adBudgetWrites(points, date, amount, today);
    let saved = null;
    for (const write of writes) {
      const day = new Date(write.date + "T00:00:00.000Z");
      const entry = await prisma.dailyAdBudget.upsert({
        where: { date: day },
        update: { amount: write.amount, updatedAt: new Date() },
        create: { date: day, amount: write.amount },
      });
      if (write.date === date) saved = entry;
    }
    revalidateAppData();
    return NextResponse.json({ ok: true, entry: saved });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** GET /api/ad-budget — recent entries, or the amount counted on ?date=YYYY-MM-DD */
export async function GET(request: Request) {
  if (!prisma) return NextResponse.json({ entries: [] });
  const date = new URL(request.url).searchParams.get("date");
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const rows = await prisma.dailyAdBudget.findMany({
      where: { date: { lte: new Date(date + "T00:00:00.000Z") } },
      orderBy: { date: "asc" },
      select: { date: true, amount: true },
    });
    const points: AdBudgetPoint[] = rows.map((entry) => ({
      date: entry.date.toISOString().slice(0, 10),
      amount: toNumber(entry.amount),
    }));
    return NextResponse.json({ date, amount: effectiveAdAmount(points, date) });
  }
  const entries = await prisma.dailyAdBudget.findMany({
    orderBy: { date: "desc" },
    take: 30,
  });
  return NextResponse.json({ entries });
}

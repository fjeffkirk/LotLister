import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { isUnauthorized, requireSession } from "@/lib/require-session";
import { log } from "@/lib/logger";
import { beginSyncRun, executeSyncRun } from "@/lib/sync/shopify-sync";
import { revalidateAppData } from "@/lib/sync/revalidate";
import { isShopifyApiReady } from "@/lib/shopify/config";

export const dynamic = "force-dynamic";
/** Allow a full Shopify catch-up to finish after the HTTP response (Vercel/serverless). */
export const maxDuration = 300;

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const session = await requireSession();
  if (isUnauthorized(session)) return session;
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503, headers: noStore });
  }
  if (!(await isShopifyApiReady())) {
    return NextResponse.json({ error: "Shopify is not connected" }, { status: 400, headers: noStore });
  }

  // Default: incremental (only changes since last success).
  // Pass ?full=1 for a deep rebuild (90-day orders + full catalog).
  const url = new URL(request.url);
  const full = url.searchParams.get("full") === "1" || url.searchParams.get("full") === "true";
  const force = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";

  const db = prisma;
  let began;
  try {
    began = await beginSyncRun(db, { full, force });
  } catch (e) {
    log.error("api/sync create", { e });
    return NextResponse.json({ error: "Could not start sync" }, { status: 500, headers: noStore });
  }

  const runId = began.run.id;
  if (began.shouldExecute) {
    const work = executeSyncRun(db, runId, { full }).catch((e) => {
      log.error("api/sync background", { e });
    });
    after(() => work);
  }

  return NextResponse.json(
    {
      ok: true,
      full,
      runId,
      skipped: began.skipped,
      reused: began.reused,
      message: began.skipped
        ? "Already synced recently"
        : began.reused
          ? "Sync already running"
          : full
            ? "Full sync started in background"
            : "Incremental sync started in background",
    },
    { headers: noStore },
  );
}

/**
 * Bust dashboard caches after a sync completes. Called from the client in
 * request context so revalidateTag/revalidatePath are reliable (unlike after()).
 */
export async function PUT() {
  revalidateAppData();
  return NextResponse.json({ ok: true }, { headers: noStore });
}

/** GET /api/sync — latest SyncRun, or a specific run via ?id= */
export async function GET(request: Request) {
  if (!prisma) {
    return NextResponse.json({ run: null, lastSuccessfulSyncAt: null }, { headers: noStore });
  }
  try {
    const id = new URL(request.url).searchParams.get("id");
    const [run, settings] = await Promise.all([
      id
        ? prisma.syncRun.findUnique({ where: { id } })
        : prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
      prisma.appSetting.findFirst({ select: { lastSuccessfulSyncAt: true } }),
    ]);
    return NextResponse.json(
      {
        run,
        lastSuccessfulSyncAt: settings?.lastSuccessfulSyncAt?.toISOString() ?? null,
      },
      { headers: noStore },
    );
  } catch {
    return NextResponse.json({ run: null, lastSuccessfulSyncAt: null }, { headers: noStore });
  }
}

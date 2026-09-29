import { NextResponse } from "next/server";
import { startBackgroundIndexer } from "@/lib/sync/background-indexer";

export const dynamic = "force-dynamic";

/** Liveness probe. Also arms the in-process Shopify indexer (async, does not wait on DB). */
export async function GET() {
  startBackgroundIndexer();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

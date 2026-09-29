import { NextResponse, after } from "next/server";
import crypto from "node:crypto";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { runSync } from "@/lib/sync/shopify-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = env.SHOPIFY_CLIENT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }
  const raw = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256") ?? "";
  const digest = crypto.createHmac("sha256", secret).update(raw).digest("base64");
  const a = Buffer.from(hmac);
  const b = Buffer.from(digest);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Invalid HMAC" }, { status: 401 });
  }

  const db = prisma;
  if (db) {
    const work = runSync(db).catch((e) => {
      log.error("webhook sync", { e });
    });
    after(() => work);
  }
  return NextResponse.json({ ok: true });
}

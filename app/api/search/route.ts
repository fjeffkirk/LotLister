import { NextResponse } from "next/server";
import { isUnauthorized, requireSession } from "@/lib/require-session";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/queries/app-settings";
import { searchOps } from "@/lib/queries/ops";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireSession();
  if (isUnauthorized(session)) return session;
  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (!prisma || q.trim().length < 2) return NextResponse.json({ hits: [] });
  const settings = await getAppSettings();
  const hits = await searchOps(prisma, q, settings?.shopifyShopDomain ?? null);
  return NextResponse.json({ hits });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { shopify } from "@/lib/shopify/client";
import { isShopifyApiReady } from "@/lib/shopify/config";
import { saveShopifyShopProfile } from "@/lib/shopify/shop-profile";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isShopifyApiReady())) {
    return NextResponse.json({ error: "Shopify is not connected" }, { status: 400 });
  }
  try {
    const info = await shopify.testConnection();
    if (prisma) {
      await saveShopifyShopProfile(prisma, { shopName: info.shopName, logoUrl: info.logoUrl });
    }
    return NextResponse.json(info);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Connection failed" },
      { status: 502 },
    );
  }
}

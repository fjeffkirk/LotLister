import { revalidatePath, revalidateTag } from "next/cache";

/** Invalidate cached figures and every app route after Shopify data changes. */
export function revalidateAppData() {
  revalidateTag("dashboard");
  revalidatePath("/", "layout");
  revalidatePath("/lots");
  revalidatePath("/ops/inventory");
  revalidatePath("/ops/orders");
  revalidatePath("/settings");
}

/** Bust KPI cache only — do not rebuild the current page (that hangs Save on Settings). */
export function revalidateDashboardFigures() {
  revalidateTag("dashboard");
}

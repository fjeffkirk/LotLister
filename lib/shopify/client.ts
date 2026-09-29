import { log } from "@/lib/logger";
import { resolveShopifyConfig } from "./config";
import {
  INVENTORY_ITEMS_PAGE,
  LOCATIONS,
  ORDERS_PAGE,
  ORDERS_PAGE_WITHOUT_FO,
  ORDERS_COUNT,
  PRODUCT_VARIANT_CENSUS,
  PRODUCTS_PAGE,
  PRODUCTS_COUNT,
  SHOP,
} from "./queries";
import type { ShopifyOrderNode, ShopifyPageInfo, ShopifyLocationNode, ShopifyVariantNode } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type GraphQLError = {
  message: string;
  path?: Array<string | number>;
  extensions?: { code?: string };
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLError[];
  extensions?: { cost?: { throttleStatus?: { currentlyAvailable: number; restoreRate: number } } };
};

function isAccessDenied(err: GraphQLError) {
  return err.extensions?.code === "ACCESS_DENIED" || /access denied/i.test(err.message);
}

function isFulfillmentOrdersDenied(err: GraphQLError) {
  if (!isAccessDenied(err)) return false;
  if (err.path?.includes("fulfillmentOrders")) return true;
  return /fulfillmentOrders/i.test(err.message);
}

type OrdersPageData = {
  orders: { pageInfo: ShopifyPageInfo; nodes: ShopifyOrderNode[] };
};

type ProductPageNode = {
  id: string;
  title: string;
  vendor: string;
  status: string;
  featuredImage?: { url: string } | null;
  variants: {
    nodes: Array<
      ShopifyVariantNode & {
        image?: { url: string } | null;
        inventoryItem?: {
          id: string;
          tracked: boolean;
          inventoryLevels?: { nodes: Array<Record<string, unknown>> };
        } | null;
        inventoryQuantity?: number;
      }
    >;
  };
};

type ProductsPageData = { products: { pageInfo: ShopifyPageInfo; nodes: ProductPageNode[] } };

type VariantCensusPage = {
  productVariants: {
    pageInfo: ShopifyPageInfo;
    nodes: Array<{ id: string; product?: { status?: string | null } | null }>;
  };
};

export type ShopifyInventoryItemNode = {
  id: string;
  tracked: boolean;
  inventoryLevels?: {
    nodes: Array<{
      location: { id: string; name: string; isActive: boolean };
      quantities: { name: string; quantity: number }[];
    }>;
  } | null;
};

type InventoryItemsPageData = {
  inventoryItems: { pageInfo: ShopifyPageInfo; nodes: ShopifyInventoryItemNode[] };
};

export class ShopifyClient {
  /** null = unknown; false after ACCESS_DENIED so later order pages skip the field. */
  private fulfillmentOrdersOk: boolean | null = null;

  async isReady(): Promise<boolean> {
    return (await resolveShopifyConfig()) != null;
  }

  /** @deprecated use isReady() */
  isConfigured(): boolean {
    // sync check only for env; async callers should use isReady
    return false;
  }

  private async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const cfg = await resolveShopifyConfig();
    if (!cfg) {
      throw new Error("Shopify is not configured: add env token or run OAuth in Settings");
    }
    const endpoint = `https://${cfg.shop}/admin/api/${cfg.version}/graphql.json`;
    const maxAttempts = 5;
    let attempt = 0;
    while (true) {
      attempt++;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": cfg.token,
        },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") || "2");
        log.warn("Shopify rate limited; backing off", { retryAfter, attempt });
        if (attempt >= maxAttempts) throw new Error("Shopify rate limit exceeded");
        await sleep(retryAfter * 1000);
        continue;
      }
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Shopify HTTP ${res.status}: ${t.slice(0, 200)}`);
      }
      const body = (await res.json()) as GraphQLResponse<T>;
      if (body.errors?.length) {
        const foDenied = body.errors.some(isFulfillmentOrdersDenied);
        const fatal = body.errors.filter((e) => !isAccessDenied(e));
        if (foDenied && this.fulfillmentOrdersOk !== false) {
          this.fulfillmentOrdersOk = false;
          log.warn(
            "Shopify token cannot read fulfillmentOrders; past-due dates need read_merchant_managed_fulfillment_orders (and related FO scopes) on the custom app.",
          );
        }
        if (fatal.length || !body.data) {
          const msg = (fatal.length ? fatal : body.errors).map((e) => e.message).join("; ");
          throw new Error(`Shopify GraphQL: ${msg}`);
        }
        // Field-level ACCESS_DENIED — keep the rest of the payload.
      }
      // Successful response: wait for the leaky bucket to recover instead of
      // re-firing the same query (that was multiplying Admin API traffic).
      const cost = body.extensions?.cost?.throttleStatus;
      if (cost && cost.currentlyAvailable < 50) {
        const restore = Math.max(cost.restoreRate || 50, 1);
        const waitMs = Math.min(2000, Math.ceil(((50 - cost.currentlyAvailable) / restore) * 1000));
        if (waitMs > 0) await sleep(waitMs);
      }
      if (!body.data) throw new Error("Shopify: empty data");
      return body.data;
    }
  }

  async shopifyqlQuery(query: string): Promise<{
    columns: { name: string; dataType: string }[];
    rows: Record<string, string | number | null>[];
  } | null> {
    try {
      const GQL = /* GraphQL */ `
        query ShopifyQL($query: String!) {
          shopifyqlQuery(query: $query) {
            __typename
            ... on TableResponse {
              tableData {
                columns { name dataType }
                rowData
              }
            }
            ... on PolarisVizResponse {
              tableData {
                columns { name dataType }
                rowData
              }
            }
          }
        }
      `;
      const data = await this.request<{
        shopifyqlQuery: {
          __typename: string;
          tableData?: {
            columns: { name: string; dataType: string }[];
            rowData: string[][];
          };
          parseErrors?: { code: string; message: string }[];
        };
      }>(GQL, { query });
      const result = data.shopifyqlQuery;
      if (!result) return null;
      if (result.__typename === "ParseError" || result.parseErrors?.length) {
        const errs = result.parseErrors?.map((e) => `${e.code}: ${e.message}`).join("; ");
        log.warn("ShopifyQL ParseError", { query, errs });
        return null;
      }
      const td = result.tableData;
      if (!td) {
        log.warn("ShopifyQL: no tableData", { typename: result.__typename });
        return null;
      }
      const cols = td.columns;
      const rows = td.rowData.map((row) => {
        const obj: Record<string, string | number | null> = {};
        cols.forEach((c, i) => {
          const v = row[i];
          obj[c.name] = v == null ? null : isNaN(Number(v)) ? v : Number(v);
        });
        return obj;
      });
      return { columns: cols, rows };
    } catch (e) {
      log.warn("ShopifyQL query failed", { e: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  async testConnection(): Promise<{ shopName: string; domain: string; logoUrl: string | null }> {
    const data = await this.request<{
      shop: {
        name: string;
        myshopifyDomain: string;
        brand?: { logo?: { image?: { url: string } | null } | null } | null;
      };
    }>(SHOP);
    return {
      shopName: data.shop.name,
      domain: data.shop.myshopifyDomain,
      logoUrl: data.shop.brand?.logo?.image?.url ?? null,
    };
  }

  async fetchAllLocations(): Promise<ShopifyLocationNode[]> {
    const data = await this.request<{
      locations: { nodes: { id: string; name: string; isActive: boolean }[] };
    }>(LOCATIONS, { first: 50 });
    return data.locations.nodes;
  }

  async *paginateOrders(queryFilter: string | undefined) {
    let cursor: string | null = null;
    let hasNext = true;
    while (hasNext) {
      const vars = { first: 25, after: cursor, query: queryFilter };
      let pageData: OrdersPageData;
      try {
        const query = this.fulfillmentOrdersOk === false ? ORDERS_PAGE_WITHOUT_FO : ORDERS_PAGE;
        pageData = await this.request<OrdersPageData>(query, vars);
      } catch (e) {
        if (this.fulfillmentOrdersOk !== false) throw e;
        pageData = await this.request<OrdersPageData>(ORDERS_PAGE_WITHOUT_FO, vars);
      }
      yield pageData.orders;
      hasNext = pageData.orders.pageInfo.hasNextPage;
      cursor = pageData.orders.pageInfo.endCursor;
    }
  }

  async *paginateProducts(queryFilter?: string) {
    let cursor: string | null = null;
    let hasNext = true;
    while (hasNext) {
      const pageData: ProductsPageData = await this.request<ProductsPageData>(PRODUCTS_PAGE, {
        first: 20,
        after: cursor,
        query: queryFilter ?? null,
      });
      yield pageData.products;
      hasNext = pageData.products.pageInfo.hasNextPage;
      cursor = pageData.products.pageInfo.endCursor;
    }
  }

  /** Total products matching an optional search query. */
  async countProducts(queryFilter?: string): Promise<number | null> {
    try {
      const data = await this.request<{ productsCount: { count: number; precision?: string } }>(PRODUCTS_COUNT, {
        query: queryFilter ?? null,
      });
      return data.productsCount?.count ?? null;
    } catch (e) {
      log.warn("productsCount failed", { message: (e as Error).message?.slice(0, 100) });
      return null;
    }
  }

  /** All variant GIDs that still exist in Shopify, plus those on archived products. */
  async fetchVariantCensus(): Promise<{ liveIds: Set<string>; archivedIds: Set<string> }> {
    const liveIds = new Set<string>();
    const archivedIds = new Set<string>();
    let cursor: string | null = null;
    let hasNext = true;
    while (hasNext) {
      const page: VariantCensusPage = await this.request<VariantCensusPage>(PRODUCT_VARIANT_CENSUS, {
        first: 250,
        after: cursor,
      });
      for (const node of page.productVariants.nodes) {
        liveIds.add(node.id);
        if ((node.product?.status ?? "").toUpperCase() === "ARCHIVED") {
          archivedIds.add(node.id);
        }
      }
      hasNext = page.productVariants.pageInfo.hasNextPage;
      cursor = page.productVariants.pageInfo.endCursor;
    }
    return { liveIds, archivedIds };
  }

  async *paginateInventoryItems(queryFilter?: string) {
    let cursor: string | null = null;
    let hasNext = true;
    while (hasNext) {
      const pageData: InventoryItemsPageData = await this.request<InventoryItemsPageData>(
        INVENTORY_ITEMS_PAGE,
        { first: 50, after: cursor, query: queryFilter ?? null },
      );
      yield pageData.inventoryItems;
      hasNext = pageData.inventoryItems.pageInfo.hasNextPage;
      cursor = pageData.inventoryItems.pageInfo.endCursor;
    }
  }

  /** Total orders matching the same filter used by paginateOrders. */
  async countOrders(queryFilter: string | undefined): Promise<number | null> {
    try {
      const data = await this.request<{ ordersCount: { count: number; precision?: string } }>(ORDERS_COUNT, {
        query: queryFilter ?? null,
      });
      return data.ordersCount?.count ?? null;
    } catch (e) {
      log.warn("ordersCount failed", { message: (e as Error).message?.slice(0, 100) });
      return null;
    }
  }
}

export const shopify = new ShopifyClient();

/** Raw shapes from Admin GraphQL — kept loose for forward compatibility */

export type ShopifyPageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

export type MoneyBag = { amount: string; currencyCode: string };

export type ShopifyLineItemNode = {
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  currentQuantity: number;
  unfulfilledQuantity: number;
  originalUnitPriceSet?: { shopMoney: MoneyBag };
  discountedUnitPriceSet?: { shopMoney: MoneyBag };
  fulfillmentStatus: string | null;
  variant?: {
    id: string;
    inventoryItem?: { id: string } | null;
  } | null;
};

export type ShopifyOrderNode = {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  subtotalPriceSet?: { shopMoney: MoneyBag };
  totalTaxSet?: { shopMoney: MoneyBag };
  totalDiscountsSet?: { shopMoney: MoneyBag };
  totalShippingPriceSet?: { shopMoney: MoneyBag };
  currentTotalPriceSet: { shopMoney: MoneyBag };
  totalPriceSet?: { shopMoney: MoneyBag };
  sourceIdentifier: string | null;
  sourceName: string | null;
  channelInformation?: {
    channelDefinition?: {
      handle?: string | null;
    } | null;
  } | null;
  lineItems: { nodes: ShopifyLineItemNode[] };
  shippingAddress?: { name?: string | null } | null;
  number: number | null;
  fulfillmentOrders?: {
    nodes: Array<{ status: string | null; fulfillBy: string | null }>;
  };
};

export type ShopifyLocationNode = {
  id: string;
  name: string;
  isActive: boolean;
};

export type ShopifyVariantNode = {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  inventoryItem: { id: string; tracked: boolean } | null;
  product: {
    id: string;
    title: string;
    vendor: string;
    status: string;
  };
  image?: { url: string; altText?: string | null } | null;
};

export type InventoryLevelNode = {
  id: string;
  quantities: Array<{
    name: string;
    quantity: number;
  }>;
  location: { id: string; name: string };
};

export const ORDERS_PAGE = /* GraphQL */ `
  query Orders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        email
        createdAt
        updatedAt
        displayFinancialStatus
        displayFulfillmentStatus
        number
        subtotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalTaxSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalDiscountsSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalShippingPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        sourceIdentifier
        sourceName
        channelInformation {
          channelDefinition {
            handle
          }
        }
        shippingAddress {
          name
        }
        lineItems(first: 100) {
          nodes {
            id
            title
            variantTitle
            sku
            currentQuantity
            unfulfilledQuantity
            fulfillmentStatus
            originalUnitPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            variant {
              id
              inventoryItem {
                id
              }
            }
          }
        }
        fulfillmentOrders(first: 10) {
          nodes {
            status
            fulfillBy
          }
        }
      }
    }
  }
`;

/** Same as ORDERS_PAGE when the token lacks fulfillment-order scopes. */
export const ORDERS_PAGE_WITHOUT_FO = ORDERS_PAGE.replace(
  /\s*fulfillmentOrders\(first: 10\) \{\s*nodes \{\s*status\s*fulfillBy\s*\}\s*\}/,
  "",
);

export const PRODUCTS_PAGE = /* GraphQL */ `
  query Products($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        vendor
        status
        featuredImage {
          url
        }
        variants(first: 50) {
          nodes {
            id
            title
            sku
            barcode
            price
            image {
              url
            }
            inventoryItem {
              id
              tracked
              inventoryLevels(first: 20) {
                nodes {
                  id
                  location {
                    id
                    name
                    isActive
                  }
                  quantities(
                    names: [
                      "available"
                      "on_hand"
                      "committed"
                      "incoming"
                      "reserved"
                    ]
                  ) {
                    name
                    quantity
                  }
                }
              }
            }
            inventoryQuantity
          }
        }
      }
    }
  }
`;

export const LOCATIONS = /* GraphQL */ `
  query Locations($first: Int!) {
    locations(first: $first) {
      nodes {
        id
        name
        isActive
      }
    }
  }
`;

export const SHOP = /* GraphQL */ `
  query Shop {
    shop {
      name
      myshopifyDomain
      plan {
        displayName
      }
      brand {
        logo {
          image {
            url
          }
        }
      }
    }
  }
`;

export const PRODUCTS_COUNT = /* GraphQL */ `
  query ProductsCount($query: String) {
    productsCount(query: $query) {
      count
      precision
    }
  }
`;

/** Lightweight variant walk so we can drop catalog rows Shopify deleted. */
export const PRODUCT_VARIANT_CENSUS = /* GraphQL */ `
  query ProductVariantCensus($first: Int!, $after: String) {
    productVariants(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        product {
          status
        }
      }
    }
  }
`;

export const ORDERS_COUNT = /* GraphQL */ `
  query OrdersCount($query: String) {
    ordersCount(query: $query) {
      count
      precision
    }
  }
`;

export const INVENTORY_ITEMS_PAGE = /* GraphQL */ `
  query InventoryItems($first: Int!, $after: String, $query: String) {
    inventoryItems(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        tracked
        inventoryLevels(first: 20) {
          nodes {
            location {
              id
              name
              isActive
            }
            quantities(
              names: [
                "available"
                "on_hand"
                "committed"
                "incoming"
                "reserved"
              ]
            ) {
              name
              quantity
            }
          }
        }
      }
    }
  }
`;

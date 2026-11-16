import type { ShopifyListingProduct } from '../ebay-shopify-listing';

export const PRODUCT_FOR_LISTING = /* GraphQL */ `
  query ProductForListing($id: ID!) {
    shop {
      currencyCode
    }
    product(id: $id) {
      id
      title
      handle
      descriptionHtml
      vendor
      productType
      tags
      status
      options {
        name
        values
      }
      media(first: 24) {
        nodes {
          ... on MediaImage {
            image {
              url
            }
          }
        }
      }
      variants(first: 100) {
        pageInfo {
          hasNextPage
        }
        nodes {
          id
          title
          sku
          barcode
          price
          inventoryQuantity
          selectedOptions {
            name
            value
          }
          image {
            url
          }
          inventoryItem {
            tracked
          }
        }
      }
    }
  }
`;

export const PRODUCT_ID_BY_SEARCH = /* GraphQL */ `
  query ProductIdBySearch($query: String!) {
    products(first: 2, query: $query) {
      nodes {
        id
        title
      }
    }
  }
`;

export const PRODUCT_ID_BY_SKU = /* GraphQL */ `
  query ProductIdBySku($query: String!) {
    productVariants(first: 5, query: $query) {
      nodes {
        sku
        product {
          id
          title
        }
      }
    }
  }
`;

export interface ProductForListingData {
  shop: { currencyCode: string };
  product: {
    id: string;
    title: string;
    handle: string;
    descriptionHtml: string | null;
    vendor: string | null;
    productType: string | null;
    tags: string[] | null;
    status: string;
    options: { name: string; values: string[] }[] | null;
    media: { nodes: ({ image?: { url: string } | null } | null)[] } | null;
    variants: {
      pageInfo: { hasNextPage: boolean };
      nodes: {
        id: string;
        title: string;
        sku: string | null;
        barcode: string | null;
        price: string;
        inventoryQuantity: number | null;
        selectedOptions: { name: string; value: string }[];
        image: { url: string } | null;
        inventoryItem: { tracked: boolean } | null;
      }[];
    };
  } | null;
}

export type ProductLookup = { productId: string } | { handle: string } | { sku: string };

export function productGid(raw: string): string {
  const value = raw.trim();
  if (/^gid:\/\/shopify\/Product\/\d+$/.test(value)) return value;
  if (/^\d+$/.test(value)) return `gid://shopify/Product/${value}`;
  throw new Error('productId must be a Shopify product id or gid://shopify/Product/… value');
}

/** Shopify search syntax treats quotes and colons specially. */
export function searchTerm(field: 'handle' | 'sku', value: string): string {
  const clean = value.trim().replace(/["\\]/g, '');
  if (!clean) throw new Error(`${field} is empty`);
  return `${field}:"${clean}"`;
}

export function normalizeListingProduct(data: ProductForListingData): ShopifyListingProduct {
  const product = data.product;
  if (!product) throw new Error('Shopify did not return that product');
  if (product.variants.pageInfo.hasNextPage) {
    throw new Error('This Shopify product has more than 100 variants. LotLister lists products with 100 or fewer.');
  }
  const variantImages = product.variants.nodes.map((variant) => variant.image?.url).filter((url): url is string => Boolean(url));
  const media = (product.media?.nodes ?? []).map((node) => node?.image?.url).filter((url): url is string => Boolean(url));
  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    descriptionHtml: product.descriptionHtml ?? '',
    vendor: product.vendor ?? '',
    productType: product.productType ?? '',
    tags: product.tags ?? [],
    status: product.status,
    currency: data.shop.currencyCode,
    options: product.options ?? [],
    images: [...new Set([...media, ...variantImages])],
    variants: product.variants.nodes.map((variant) => ({
      id: variant.id,
      title: variant.title,
      sku: variant.sku ?? '',
      barcode: variant.barcode ?? '',
      price: Number(variant.price),
      quantity: variant.inventoryItem?.tracked === false ? null : variant.inventoryQuantity ?? 0,
      options: variant.selectedOptions,
      image: variant.image?.url ?? null,
    })),
  };
}

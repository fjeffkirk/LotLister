CREATE TABLE IF NOT EXISTS "EbayListingDefaults" (
  "userEmail" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "shippingService" TEXT NOT NULL DEFAULT 'USPSParcel',
  "shippingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "freeShipping" BOOLEAN NOT NULL DEFAULT false,
  "additionalItemCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "handlingDays" INTEGER NOT NULL DEFAULT 1,
  "returnsAccepted" BOOLEAN NOT NULL DEFAULT true,
  "returnDays" INTEGER NOT NULL DEFAULT 30,
  "returnShippingPaidBy" TEXT NOT NULL DEFAULT 'Buyer',
  "bestOfferEnabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EbayListingDefaults_pkey" PRIMARY KEY ("userEmail")
);

CREATE TABLE IF NOT EXISTS "EbayProductListing" (
  "id" TEXT NOT NULL,
  "previewId" TEXT NOT NULL,
  "userEmail" TEXT NOT NULL,
  "shopifyProductId" TEXT NOT NULL,
  "uuid" TEXT NOT NULL,
  "itemXml" TEXT NOT NULL,
  "summary" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "ebayItemId" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EbayProductListing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EbayProductListing_previewId_key"
  ON "EbayProductListing"("previewId");

CREATE INDEX IF NOT EXISTS "EbayProductListing_userEmail_shopifyProductId_idx"
  ON "EbayProductListing"("userEmail", "shopifyProductId");

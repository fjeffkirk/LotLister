-- CreateEnum
CREATE TYPE "SyncMode" AS ENUM ('manual', 'polling', 'webhook_ready');

-- CreateEnum
CREATE TYPE "CatalogType" AS ENUM ('product', 'supply');

-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "SyncRunType" AS ENUM ('full', 'incremental', 'orders', 'products', 'inventory', 'fulfillment', 'test_connection');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('running', 'success', 'failed');

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "defaultMarginPercent" DOUBLE PRECISION NOT NULL DEFAULT 35,
    "syncMode" "SyncMode" NOT NULL DEFAULT 'polling',
    "pollingIntervalMinutes" INTEGER NOT NULL DEFAULT 10,
    "lowStockDefaultThreshold" INTEGER NOT NULL DEFAULT 5,
    "defaultReorderQuantity" INTEGER NOT NULL DEFAULT 1,
    "averageFreeShippingCost" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "fulfillmentDueHours" INTEGER NOT NULL DEFAULT 24,
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "shopifyShopDomain" TEXT,
    "shopifyAccessToken" TEXT,
    "shopifyShopName" TEXT,
    "shopifyShopLogoUrl" TEXT,
    "shopifyConnectedAt" TIMESTAMP(3),
    "shopifyConnectedAppVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "shopifyLocationId" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL,
    "type" "CatalogType" NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',
    "title" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "vendor" TEXT,
    "category" TEXT,
    "subtype" TEXT,
    "description" TEXT,
    "imageUrl" TEXT,
    "thumbnailUrl" TEXT,
    "internalProductUrl" TEXT,
    "reorderUrl" TEXT,
    "supplierName" TEXT,
    "notes" TEXT,
    "costBasis" DECIMAL(14,4),
    "sellingPrice" DECIMAL(14,4),
    "marginPercentOverride" DOUBLE PRECISION,
    "reorderThreshold" INTEGER,
    "reorderQuantity" INTEGER,
    "trackInventory" BOOLEAN NOT NULL DEFAULT true,
    "skipLowStockAlert" BOOLEAN NOT NULL DEFAULT false,
    "productGroup" TEXT,
    "shopifyProductId" TEXT,
    "shopifyVariantId" TEXT,
    "shopifyInventoryItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySnapshot" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "available" INTEGER NOT NULL DEFAULT 0,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "committed" INTEGER NOT NULL DEFAULT 0,
    "incoming" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderNumber" INTEGER,
    "orderName" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "financialStatus" TEXT,
    "fulfillmentStatus" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotal" DECIMAL(14,4) NOT NULL,
    "shippingCollected" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,4) NOT NULL,
    "estimatedProfit" DECIMAL(14,4),
    "profitIsEstimated" BOOLEAN NOT NULL DEFAULT true,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "fulfillBy" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sourceChannel" TEXT,
    "rawPayloadJson" TEXT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLineItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "shopifyLineItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "lineRevenue" DECIMAL(14,4) NOT NULL,
    "estimatedUnitCost" DECIMAL(14,4),
    "estimatedLineProfit" DECIMAL(14,4),
    "profitIsExact" BOOLEAN NOT NULL DEFAULT false,
    "fulfillmentStatus" TEXT,

    CONSTRAINT "OrderLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyAdBudget" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyAdBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "type" "SyncRunType" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" "SyncRunStatus" NOT NULL DEFAULT 'running',
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "progressPhase" TEXT,
    "progressCurrent" INTEGER NOT NULL DEFAULT 0,
    "progressTotal" INTEGER,
    "errorMessage" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_shopifyLocationId_key" ON "Location"("shopifyLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_shopifyVariantId_key" ON "CatalogItem"("shopifyVariantId");

-- CreateIndex
CREATE INDEX "CatalogItem_type_idx" ON "CatalogItem"("type");

-- CreateIndex
CREATE INDEX "CatalogItem_status_idx" ON "CatalogItem"("status");

-- CreateIndex
CREATE INDEX "CatalogItem_sku_idx" ON "CatalogItem"("sku");

-- CreateIndex
CREATE INDEX "InventorySnapshot_catalogItemId_locationId_snapshotAt_idx" ON "InventorySnapshot"("catalogItemId", "locationId", "snapshotAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_shopifyOrderId_key" ON "Order"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "Order_orderDate_idx" ON "Order"("orderDate");

-- CreateIndex
CREATE INDEX "Order_fulfillmentStatus_idx" ON "Order"("fulfillmentStatus");

-- CreateIndex
CREATE INDEX "Order_fulfillBy_idx" ON "Order"("fulfillBy");

-- CreateIndex
CREATE INDEX "Order_sourceChannel_idx" ON "Order"("sourceChannel");

-- CreateIndex
CREATE INDEX "Order_customerEmail_idx" ON "Order"("customerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLineItem_shopifyLineItemId_key" ON "OrderLineItem"("shopifyLineItemId");

-- CreateIndex
CREATE INDEX "OrderLineItem_orderId_idx" ON "OrderLineItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderLineItem_catalogItemId_idx" ON "OrderLineItem"("catalogItemId");

-- CreateIndex
CREATE INDEX "OrderLineItem_sku_idx" ON "OrderLineItem"("sku");

-- CreateIndex
CREATE INDEX "DailyAdBudget_date_idx" ON "DailyAdBudget"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyAdBudget_date_key" ON "DailyAdBudget"("date");

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

-- AddForeignKey
ALTER TABLE "InventorySnapshot" ADD CONSTRAINT "InventorySnapshot_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySnapshot" ADD CONSTRAINT "InventorySnapshot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineItem" ADD CONSTRAINT "OrderLineItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineItem" ADD CONSTRAINT "OrderLineItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "User" (
    "email" TEXT NOT NULL PRIMARY KEY,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL DEFAULT 'legacy@lotlister.app',
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CardItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lotId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "listings" TEXT,
    "salePrice" REAL,
    "category" TEXT NOT NULL DEFAULT 'Baseball',
    "year" INTEGER,
    "brand" TEXT,
    "setName" TEXT,
    "name" TEXT,
    "cardNumber" TEXT,
    "subsetParallel" TEXT,
    "attributes" TEXT,
    "team" TEXT,
    "variation" TEXT,
    "graded" BOOLEAN NOT NULL DEFAULT false,
    "grader" TEXT,
    "grade" TEXT,
    "conditionType" TEXT NOT NULL DEFAULT 'Ungraded: Not in original packaging or professionally graded',
    "condition" TEXT NOT NULL DEFAULT 'Near Mint or Better',
    "certNo" TEXT,
    "description" TEXT,
    "psaImport" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "CardItem_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CardImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cardItemId" TEXT NOT NULL,
    "originalPath" TEXT NOT NULL,
    "thumbPath" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CardImage_cardItemId_fkey" FOREIGN KEY ("cardItemId") REFERENCES "CardItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExportProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lotId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "templateName" TEXT NOT NULL DEFAULT '7 Day Auction',
    "ebayCategory" TEXT NOT NULL DEFAULT '261328',
    "storeCategory" TEXT NOT NULL DEFAULT '0',
    "listingType" TEXT NOT NULL DEFAULT 'Auction',
    "startPriceDefault" REAL NOT NULL DEFAULT 4.99,
    "buyItNowPrice" REAL,
    "durationDays" INTEGER NOT NULL DEFAULT 7,
    "scheduleMode" TEXT NOT NULL DEFAULT 'Scheduled',
    "scheduleDate" TEXT,
    "scheduleTime" TEXT,
    "staggerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "staggerIntervalSeconds" INTEGER NOT NULL DEFAULT 15,
    "shippingService" TEXT NOT NULL DEFAULT 'USPS Ground Advantage',
    "handlingTimeDays" INTEGER NOT NULL DEFAULT 3,
    "freeShipping" BOOLEAN NOT NULL DEFAULT false,
    "shippingCost" REAL NOT NULL DEFAULT 3.99,
    "eachAdditionalItemCost" REAL NOT NULL DEFAULT 1.49,
    "immediatePayment" BOOLEAN NOT NULL DEFAULT false,
    "bestOfferEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bestOfferAutoAcceptPrice" REAL,
    "bestOfferMinimumPrice" REAL,
    "itemLocationCity" TEXT,
    "itemLocationState" TEXT,
    "itemLocationZip" TEXT,
    "returnsAccepted" BOOLEAN NOT NULL DEFAULT true,
    "returnWindowDays" INTEGER NOT NULL DEFAULT 14,
    "refundMethod" TEXT NOT NULL DEFAULT 'Money Back',
    "shippingCostPaidBy" TEXT NOT NULL DEFAULT 'Seller',
    "salesTaxEnabled" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ExportProfile_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Lot_userEmail_idx" ON "Lot"("userEmail");

-- CreateIndex
CREATE INDEX "CardItem_lotId_idx" ON "CardItem"("lotId");

-- CreateIndex
CREATE INDEX "CardImage_cardItemId_idx" ON "CardImage"("cardItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ExportProfile_lotId_key" ON "ExportProfile"("lotId");

-- CreateIndex
CREATE INDEX "ExportProfile_lotId_idx" ON "ExportProfile"("lotId");

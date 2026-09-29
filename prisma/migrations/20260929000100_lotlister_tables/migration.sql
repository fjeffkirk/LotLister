-- CreateTable
CREATE TABLE "User" (
    "email" TEXT NOT NULL,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL DEFAULT 'legacy@lotlister.app',
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "cardDefaults" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardItem" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "listings" TEXT,
    "salePrice" DOUBLE PRECISION,
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
    "ebayItemId" TEXT,
    "ebayListedAt" TIMESTAMP(3),

    CONSTRAINT "CardItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardImage" (
    "id" TEXT NOT NULL,
    "cardItemId" TEXT NOT NULL,
    "originalPath" TEXT NOT NULL,
    "thumbPath" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CardImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportProfile" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "templateName" TEXT NOT NULL DEFAULT '7 Day Auction',
    "ebayCategory" TEXT NOT NULL DEFAULT '261328',
    "storeCategory" TEXT NOT NULL DEFAULT '0',
    "listingType" TEXT NOT NULL DEFAULT 'Auction',
    "startPriceDefault" DOUBLE PRECISION NOT NULL DEFAULT 4.99,
    "buyItNowPrice" DOUBLE PRECISION,
    "durationDays" INTEGER NOT NULL DEFAULT 7,
    "scheduleMode" TEXT NOT NULL DEFAULT 'Scheduled',
    "scheduleDate" TEXT,
    "scheduleTime" TEXT,
    "staggerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "staggerIntervalSeconds" INTEGER NOT NULL DEFAULT 15,
    "shippingService" TEXT NOT NULL DEFAULT 'USPS Ground Advantage',
    "handlingTimeDays" INTEGER NOT NULL DEFAULT 3,
    "freeShipping" BOOLEAN NOT NULL DEFAULT false,
    "shippingCost" DOUBLE PRECISION NOT NULL DEFAULT 3.99,
    "eachAdditionalItemCost" DOUBLE PRECISION NOT NULL DEFAULT 1.49,
    "immediatePayment" BOOLEAN NOT NULL DEFAULT false,
    "bestOfferEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bestOfferAutoAcceptPrice" DOUBLE PRECISION,
    "bestOfferMinimumPrice" DOUBLE PRECISION,
    "itemLocationCity" TEXT,
    "itemLocationState" TEXT,
    "itemLocationZip" TEXT,
    "returnsAccepted" BOOLEAN NOT NULL DEFAULT true,
    "returnWindowDays" INTEGER NOT NULL DEFAULT 14,
    "refundMethod" TEXT NOT NULL DEFAULT 'Money Back',
    "shippingCostPaidBy" TEXT NOT NULL DEFAULT 'Seller',
    "salesTaxEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ExportProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EbayConnection" (
    "userEmail" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "ebayUserId" TEXT,
    "ebayUsername" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EbayConnection_pkey" PRIMARY KEY ("userEmail")
);

-- CreateTable
CREATE TABLE "EbayItemPlayer" (
    "itemId" TEXT NOT NULL,
    "player" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EbayItemPlayer_pkey" PRIMARY KEY ("itemId")
);

-- CreateTable
CREATE TABLE "EbayDeletionNotification" (
    "notificationId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connectionsDeleted" INTEGER NOT NULL,
    "lotsDeleted" INTEGER NOT NULL DEFAULT 0,
    "cardsCleared" INTEGER NOT NULL,

    CONSTRAINT "EbayDeletionNotification_pkey" PRIMARY KEY ("notificationId")
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

-- CreateIndex
CREATE INDEX "EbayConnection_ebayUserId_idx" ON "EbayConnection"("ebayUserId");

-- CreateIndex
CREATE INDEX "EbayConnection_ebayUsername_idx" ON "EbayConnection"("ebayUsername");

-- AddForeignKey
ALTER TABLE "CardItem" ADD CONSTRAINT "CardItem_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardImage" ADD CONSTRAINT "CardImage_cardItemId_fkey" FOREIGN KEY ("cardItemId") REFERENCES "CardItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportProfile" ADD CONSTRAINT "ExportProfile_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "EbayPricePreviewLine" (
  "id" TEXT NOT NULL,
  "previewId" TEXT NOT NULL,
  "userEmail" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "variationSku" TEXT NOT NULL DEFAULT '',
  "listingSku" TEXT,
  "title" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "originalCents" INTEGER NOT NULL,
  "proposedCents" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "verifiedCents" INTEGER,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EbayPricePreviewLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EbayPricePreviewLine_previewId_itemId_variationSku_key"
  ON "EbayPricePreviewLine"("previewId", "itemId", "variationSku");

CREATE INDEX IF NOT EXISTS "EbayPricePreviewLine_previewId_userEmail_idx"
  ON "EbayPricePreviewLine"("previewId", "userEmail");

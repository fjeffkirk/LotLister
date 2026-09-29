-- Per-card listing format. NULL means the card follows its lot's ExportProfile.listingType.
ALTER TABLE "CardItem" ADD COLUMN "listingType" TEXT;

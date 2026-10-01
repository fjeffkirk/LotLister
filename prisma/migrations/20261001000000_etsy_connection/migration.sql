ALTER TABLE "CardItem" ADD COLUMN IF NOT EXISTS "etsyListingId" TEXT;
ALTER TABLE "CardItem" ADD COLUMN IF NOT EXISTS "etsyListedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "EtsyConnection" (
    "userEmail" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "etsyUserId" TEXT,
    "shopId" TEXT,
    "shopName" TEXT,
    "shippingProfileId" TEXT,
    "readinessStateId" TEXT,
    "returnPolicyId" TEXT,
    "taxonomyId" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EtsyConnection_pkey" PRIMARY KEY ("userEmail")
);

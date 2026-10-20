-- TikTok Marketing API connection, Box Buddy management policy, and change history.
CREATE TABLE "TiktokConnection" (
  "id" TEXT NOT NULL,
  "userEmail" TEXT NOT NULL,
  "accessTokenEncrypted" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'connected',
  "statusDetail" TEXT,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TiktokConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TiktokConnection_userEmail_key" ON "TiktokConnection"("userEmail");

CREATE TABLE "TiktokAdvertiser" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "userEmail" TEXT NOT NULL,
  "advertiserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "currency" TEXT,
  "timezone" TEXT,
  "selected" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TiktokAdvertiser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TiktokAdvertiser_userEmail_advertiserId_key" ON "TiktokAdvertiser"("userEmail", "advertiserId");
CREATE INDEX "TiktokAdvertiser_userEmail_selected_idx" ON "TiktokAdvertiser"("userEmail", "selected");
ALTER TABLE "TiktokAdvertiser" ADD CONSTRAINT "TiktokAdvertiser_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "TiktokConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TiktokManagementPolicy" (
  "id" TEXT NOT NULL,
  "userEmail" TEXT NOT NULL,
  "advertiserId" TEXT NOT NULL,
  "productScope" TEXT NOT NULL DEFAULT 'Box Buddies',
  "dailyBudgetUsd" DECIMAL(10,2) NOT NULL DEFAULT 20,
  "peakSpendAuthorizedUsd" DECIMAL(10,2),
  "totalTestCapUsd" DECIMAL(12,2),
  "endDate" TIMESTAMP(3),
  "targetCpaUsd" DECIMAL(10,2) NOT NULL DEFAULT 15,
  "observationHours" INTEGER NOT NULL DEFAULT 72,
  "reportingDelayHours" INTEGER NOT NULL DEFAULT 6,
  "minPurchasesBeforePause" INTEGER NOT NULL DEFAULT 5,
  "scheduledReviewEnabled" BOOLEAN NOT NULL DEFAULT false,
  "safetyRulesEnabled" BOOLEAN NOT NULL DEFAULT false,
  "emergencyPaused" BOOLEAN NOT NULL DEFAULT false,
  "routineAdjustments" BOOLEAN NOT NULL DEFAULT true,
  "managedDailyUsd" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TiktokManagementPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TiktokManagementPolicy_userEmail_advertiserId_key" ON "TiktokManagementPolicy"("userEmail", "advertiserId");

CREATE TABLE "TiktokManagedCampaign" (
  "id" TEXT NOT NULL,
  "userEmail" TEXT NOT NULL,
  "advertiserId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "dailyBudget" DECIMAL(10,2) NOT NULL,
  "kind" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TiktokManagedCampaign_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TiktokManagedCampaign_userEmail_campaignId_key" ON "TiktokManagedCampaign"("userEmail", "campaignId");
CREATE INDEX "TiktokManagedCampaign_userEmail_advertiserId_idx" ON "TiktokManagedCampaign"("userEmail", "advertiserId");

CREATE TABLE "TiktokPreview" (
  "id" TEXT NOT NULL,
  "userEmail" TEXT NOT NULL,
  "advertiserId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "authorizedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TiktokPreview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TiktokPreview_userEmail_advertiserId_idx" ON "TiktokPreview"("userEmail", "advertiserId");

CREATE TABLE "TiktokChange" (
  "id" TEXT NOT NULL,
  "userEmail" TEXT NOT NULL,
  "advertiserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "reason" TEXT NOT NULL,
  "beforeJson" TEXT,
  "afterJson" TEXT,
  "idempotencyKey" TEXT,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TiktokChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TiktokChange_userEmail_idempotencyKey_key" ON "TiktokChange"("userEmail", "idempotencyKey");
CREATE INDEX "TiktokChange_userEmail_createdAt_idx" ON "TiktokChange"("userEmail", "createdAt");

CREATE TABLE "TiktokReviewRun" (
  "id" TEXT NOT NULL,
  "userEmail" TEXT NOT NULL,
  "advertiserId" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TiktokReviewRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TiktokReviewRun_userEmail_createdAt_idx" ON "TiktokReviewRun"("userEmail", "createdAt");

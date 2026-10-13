CREATE TABLE "YoutubeConnection" (
    "id" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelTitle" TEXT NOT NULL,
    "channelHandle" TEXT,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT,
    "accessExpiresAt" TIMESTAMP(3),
    "scopes" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "statusDetail" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "YoutubeConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "YoutubeConnection_userEmail_channelId_key" ON "YoutubeConnection"("userEmail", "channelId");
CREATE INDEX "YoutubeConnection_userEmail_idx" ON "YoutubeConnection"("userEmail");

CREATE TABLE "YoutubeMediaAsset" (
    "id" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER,
    "storagePath" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "YoutubeMediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "YoutubeMediaAsset_userEmail_idx" ON "YoutubeMediaAsset"("userEmail");

CREATE TABLE "YoutubeUploadJob" (
    "id" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelTitle" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "thumbnailAssetId" TEXT,
    "status" TEXT NOT NULL,
    "progressBytes" INTEGER NOT NULL DEFAULT 0,
    "byteSize" INTEGER NOT NULL DEFAULT 0,
    "bytesAcked" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "completionUncertain" BOOLEAN NOT NULL DEFAULT false,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockToken" TEXT,
    "resumableSessionEnc" TEXT,
    "youtubeVideoId" TEXT,
    "requestedVisibility" TEXT NOT NULL,
    "publicationIntent" BOOLEAN NOT NULL DEFAULT false,
    "publishAt" TIMESTAMP(3),
    "metadataJson" TEXT NOT NULL,
    "actualVisibility" TEXT,
    "restriction" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "thumbnailError" TEXT,
    "thumbnailStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "YoutubeUploadJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "YoutubeUploadJob_userEmail_idempotencyKey_key" ON "YoutubeUploadJob"("userEmail", "idempotencyKey");
CREATE INDEX "YoutubeUploadJob_status_nextAttemptAt_idx" ON "YoutubeUploadJob"("status", "nextAttemptAt");
CREATE INDEX "YoutubeUploadJob_userEmail_idx" ON "YoutubeUploadJob"("userEmail");
CREATE INDEX "YoutubeUploadJob_youtubeVideoId_idx" ON "YoutubeUploadJob"("youtubeVideoId");

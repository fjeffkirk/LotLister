-- Remember when YouTube accepted a LotLister upload so it can be deleted seven days later.
ALTER TABLE "YoutubeUploadJob" ADD COLUMN "uploadedAt" TIMESTAMP(3);

-- Existing accepted uploads use their last update as the upload time.
UPDATE "YoutubeUploadJob" SET "uploadedAt" = "updatedAt" WHERE "youtubeVideoId" IS NOT NULL;

CREATE INDEX "YoutubeUploadJob_uploadedAt_idx" ON "YoutubeUploadJob"("uploadedAt");

-- Widen byte counters without dropping or resetting existing upload records.
ALTER TABLE "YoutubeMediaAsset" ALTER COLUMN "byteSize" TYPE BIGINT;
ALTER TABLE "YoutubeUploadJob"
  ALTER COLUMN "progressBytes" TYPE BIGINT,
  ALTER COLUMN "byteSize" TYPE BIGINT,
  ALTER COLUMN "bytesAcked" TYPE BIGINT;

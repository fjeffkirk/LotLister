export class YoutubeUserError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'YoutubeUserError';
    this.code = code;
  }
}

export type Visibility = 'private' | 'unlisted' | 'public';

export type JobStatus =
  | 'queued'
  | 'waiting_media'
  | 'uploading'
  | 'uploaded'
  | 'processing'
  | 'processed'
  | 'rejected'
  | 'failed'
  | 'held'
  | 'uncertain';

export interface YoutubeVideo {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    tags?: string[];
    categoryId?: string;
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
    channelId?: string;
    channelTitle?: string;
  };
  status?: {
    uploadStatus?: string;
    failureReason?: string;
    rejectionReason?: string;
    privacyStatus?: string;
    publishAt?: string;
    embeddable?: boolean;
    license?: string;
    publicStatsViewable?: boolean;
    madeForKids?: boolean;
    selfDeclaredMadeForKids?: boolean;
    containsSyntheticMedia?: boolean;
  };
  processingDetails?: {
    processingStatus?: string;
    processingFailureReason?: string;
  };
  contentDetails?: {
    hasCustomThumbnail?: boolean;
    regionRestriction?: {
      allowed?: string[];
      blocked?: string[];
    };
  };
}

export interface NormalizedUpload {
  privacyStatus: Visibility;
  publishAt: string | null;
  publicationIntent: boolean;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  defaultLanguage: string | null;
  defaultAudioLanguage: string | null;
  madeForKids: boolean;
  containsSyntheticMedia: boolean;
  requestHash: string;
}

export interface UploadJobState {
  id: string;
  userEmail: string;
  connectionId: string;
  channelId: string;
  channelTitle: string;
  idempotencyKey: string;
  requestHash: string;
  mediaAssetId: string;
  thumbnailAssetId: string | null;
  status: JobStatus;
  progressBytes: number;
  byteSize: number;
  bytesAcked: number;
  attemptCount: number;
  completionUncertain: boolean;
  nextAttemptAt: Date | null;
  resumableSessionEnc: string | null;
  youtubeVideoId: string | null;
  requestedVisibility: Visibility;
  publicationIntent: boolean;
  publishAt: Date | null;
  metadata: NormalizedUpload;
  actualVisibility: string | null;
  restriction: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  thumbnailError: string | null;
  thumbnailStatus: string | null;
}

export interface SessionQuery {
  type: 'incomplete' | 'complete' | 'expired' | 'retry' | 'fatal';
  acked?: number;
  videoId?: string;
  video?: YoutubeVideo;
  code?: string;
  message?: string;
}

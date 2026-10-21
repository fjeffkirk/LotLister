import { z } from 'zod';
import { registerTool } from '../registry';
import {
  DIRECT_UPLOAD_INSTRUCTIONS,
  listConnections,
  prepareMedia,
  publishVideo,
  readVideo,
  scheduleVideo,
  setVideoThumbnail,
  startVideoUpload,
  updateMetadata,
  uploadStatus,
  connectionStatus,
} from '../../youtube/service';
import { publicOrigin } from '../oauth';
import { holdUnstartedUpload } from '../../youtube/jobs';
import { channelInventory, deleteOutsideTopFive } from '../../youtube/cleanup';

const connectionId = z.string().trim().min(8).max(40);
const videoId = z.string().regex(/^[A-Za-z0-9_-]{6,20}$/);
const visibility = z.enum(['private', 'unlisted', 'public']);

registerTool({
  name: 'youtube_channel_inventory',
  description: 'Read the complete owner-authenticated uploads inventory, including private and unlisted videos, ranked by lifetime views. Returns five protected IDs and current visibility. Fails rather than ranking incomplete data. Does not modify videos.',
  effect: 'youtube', readOnly: true, idempotent: true, openWorld: true,
  inputSchema: { type: 'object', properties: { connectionId: { type: 'string' }, expectedChannelId: { type: 'string' } }, required: ['connectionId', 'expectedChannelId'], additionalProperties: false },
  async handler(ctx, args) {
    const parsed = z.object({ connectionId, expectedChannelId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/) }).strict().parse(args);
    return channelInventory(ctx.accountId, parsed.connectionId, parsed.expectedChannelId);
  },
});

// Permanent deletion remains absent unless an operator explicitly approves
// channel-scoped activation. The handler repeats this gate on every invocation.
if (process.env.YOUTUBE_CLEANUP_CHANNEL_IDS?.trim()) registerTool({
  name: 'youtube_video_delete',
  description: 'Permanently delete one explicitly authorized video outside the current top five. Irreversible: views and comments are not transferred to a reupload. Requires an operator-enabled channel, exact title and channel, all five keeper IDs, and deletionIntent true. Rechecks complete ranking and ownership before deleting. Never call without explicit user deletion authorization and a saved inventory.',
  effect: 'youtube', readOnly: false, destructive: true, idempotent: false, openWorld: true,
  inputSchema: { type: 'object', properties: {
    connectionId: { type: 'string' }, expectedChannelId: { type: 'string' }, videoId: { type: 'string' },
    expectedTitle: { type: 'string' }, protectedVideoIds: { type: 'array', items: { type: 'string' }, minItems: 5, maxItems: 5, uniqueItems: true },
    deletionIntent: { type: 'boolean', const: true },
  }, required: ['connectionId', 'expectedChannelId', 'videoId', 'expectedTitle', 'protectedVideoIds', 'deletionIntent'], additionalProperties: false },
  async handler(ctx, args) {
    const parsed = z.object({ connectionId, expectedChannelId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/),
      videoId, expectedTitle: z.string().min(1).max(100), protectedVideoIds: z.array(videoId).length(5), deletionIntent: z.literal(true),
    }).strict().parse(args);
    return deleteOutsideTopFive(ctx.accountId, parsed);
  },
});

function origin(): string {
  return publicOrigin(process.env.NEXT_PUBLIC_APP_URL || 'https://lotlister.onrender.com');
}

registerTool({
  name: 'youtube_connections_list',
  description: 'List YouTube channels connected to this LotLister account. Copy connectionId and channelId before uploading. Does not return tokens. Uploads must name a connectionId so the video cannot go to the wrong channel.',
  effect: 'youtube',
  readOnly: true,
  idempotent: true,
  openWorld: true,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async handler(ctx) {
    const connections = await listConnections(ctx.accountId);
    return {
      connections,
      note: connections.length === 0
        ? 'No YouTube channel is connected. Connect one in LotLister settings and confirm the channel id in YouTube Studio before uploading.'
        : 'Compare channelId with YouTube Studio → Settings → Channel → Advanced settings before uploading.',
    };
  },
});

registerTool({
  name: 'youtube_connection_status',
  description: 'Read one connected YouTube channel: name, channel id, and whether it needs to be reconnected. Does not return tokens.',
  effect: 'youtube',
  readOnly: true,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: { connectionId: { type: 'string' } },
    required: ['connectionId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({ connectionId }).strict().parse(args);
    return connectionStatus(ctx.accountId, parsed.connectionId);
  },
});

registerTool({
  name: 'youtube_media_upload_prepare',
  description: `Prepare durable storage for a video or thumbnail. Do not send bytes or base64. ${DIRECT_UPLOAD_INSTRUCTIONS}`,
  effect: 'youtube',
  readOnly: false,
  idempotent: false,
  openWorld: false,
  inputSchema: {
    type: 'object',
    properties: {
      filename: { type: 'string' },
      byteSize: { type: 'integer', minimum: 1 },
      contentType: { type: 'string', description: 'video/mp4, video/webm, video/quicktime, image/jpeg, image/png, or image/gif' },
      sourceUrl: { type: 'string', description: 'Public https URL only. Not a sandbox URL.' },
    },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      filename: z.string().trim().min(1).max(180).optional(),
      byteSize: z.number().int().positive().optional(),
      contentType: z.string().trim().max(80).optional(),
      sourceUrl: z.string().trim().url().max(2000).optional(),
    }).strict().parse(args);
    return prepareMedia(ctx.accountId, origin(), parsed);
  },
});

const uploadFields = {
  connectionId,
  mediaAssetId: z.string().trim().min(8).max(40),
  thumbnailAssetId: z.string().trim().min(8).max(40).optional(),
  idempotencyKey: z.string().trim().regex(/^[A-Za-z0-9._:-]{8,80}$/),
  title: z.string().trim().min(1).max(100),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string()).max(30).optional(),
  categoryId: z.string().regex(/^\d{1,3}$/),
  language: z.string().max(16).optional(),
  audioLanguage: z.string().max(16).optional(),
  madeForKids: z.boolean(),
  containsSyntheticMedia: z.boolean(),
  visibility: visibility.optional(),
  publicationIntent: z.literal(true).optional(),
  publishAt: z.string().max(40).optional(),
  timeZone: z.string().max(80).optional(),
};

registerTool({
  name: 'youtube_upload_video',
  description: 'Queue a resumable YouTube upload for a media asset that is already stored here. Returns a job id immediately. Defaults to private. Pass the connectionId of the exact channel. Reuse the same idempotencyKey when retrying. madeForKids and containsSyntheticMedia are required and are not inferred. Do not send the video bytes to this tool.',
  effect: 'youtube',
  readOnly: false,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    required: ['connectionId', 'mediaAssetId', 'idempotencyKey', 'title', 'categoryId', 'madeForKids', 'containsSyntheticMedia'],
    properties: {
      connectionId: { type: 'string', description: 'From youtube_connections_list. Required so the video cannot go to another channel.' },
      mediaAssetId: { type: 'string' },
      thumbnailAssetId: { type: 'string' },
      idempotencyKey: { type: 'string', description: 'Reuse this exact key on retries. A new key can create another video.' },
      title: { type: 'string' },
      description: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      categoryId: { type: 'string', description: 'YouTube numeric category id. Required. Not chosen by LotLister.' },
      language: { type: 'string' },
      audioLanguage: { type: 'string' },
      madeForKids: { type: 'boolean' },
      containsSyntheticMedia: { type: 'boolean', description: 'Required declaration of altered or synthetic content.' },
      visibility: { type: 'string', enum: ['private', 'unlisted', 'public'], description: 'Defaults to private.' },
      publicationIntent: { type: 'boolean', const: true, description: 'Required boolean true for public, unlisted, or scheduled publishing.' },
      publishAt: { type: 'string' },
      timeZone: { type: 'string', description: 'IANA zone such as America/New_York. Required when publishAt has no offset.' },
    },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object(uploadFields).strict().parse(args);
    return startVideoUpload({ accountId: ctx.accountId, ...parsed });
  },
});

registerTool({
  name: 'youtube_upload_hold',
  description: 'Hold a superseded upload only if no transfer has started and no worker owns it. Preserves media and audit history. Does not delete a video or change visibility. Refuses active, started, and uncertain jobs. Repeating a successful hold is safe.',
  effect: 'youtube',
  readOnly: false,
  idempotent: true,
  openWorld: false,
  inputSchema: {
    type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'], additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({ jobId: z.string().trim().min(8).max(40) }).strict().parse(args);
    return holdUnstartedUpload(ctx.accountId, parsed.jobId);
  },
});

registerTool({
  name: 'youtube_upload_status',
  description: 'Read an upload job. processed is the only finished success state. uploaded and processing are not done. actualVisibility is what YouTube reported, which can stay private after an upload. YouTube videos are never automatically deleted. deletesAt is always null. Only LotLister local video files are cleaned up after seven days, deferred while needed by pending or uncertain jobs.',
  effect: 'youtube',
  readOnly: true,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: { jobId: { type: 'string' } },
    required: ['jobId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({ jobId: z.string().trim().min(8).max(40) }).strict().parse(args);
    return uploadStatus(ctx.accountId, parsed.jobId);
  },
});

registerTool({
  name: 'youtube_video_get',
  description: 'Read one video on the selected connected channel, including verified privacy, processing, and region restrictions. Fails if the video is not on that channel.',
  effect: 'youtube',
  readOnly: true,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: { connectionId: { type: 'string' }, videoId: { type: 'string' } },
    required: ['connectionId', 'videoId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({ connectionId, videoId }).strict().parse(args);
    return readVideo(ctx.accountId, parsed.connectionId, parsed.videoId);
  },
});

registerTool({
  name: 'youtube_video_update_metadata',
  description: 'Update only the metadata fields you pass. Title, description, tags, category, language, and declarations you omit are kept. This does not change visibility unless you pass a declaration that requires the status part, and even then privacy is preserved.',
  effect: 'youtube',
  readOnly: false,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: {
      connectionId: { type: 'string' },
      videoId: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      categoryId: { type: 'string' },
      language: { type: 'string' },
      audioLanguage: { type: 'string' },
      madeForKids: { type: 'boolean' },
      containsSyntheticMedia: { type: 'boolean' },
    },
    required: ['connectionId', 'videoId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      connectionId,
      videoId,
      title: z.string().trim().min(1).max(100).optional(),
      description: z.string().max(5000).optional(),
      tags: z.array(z.string()).max(30).optional(),
      categoryId: z.string().regex(/^\d{1,3}$/).optional(),
      language: z.string().max(16).nullable().optional(),
      audioLanguage: z.string().max(16).nullable().optional(),
      madeForKids: z.boolean().optional(),
      containsSyntheticMedia: z.boolean().optional(),
    }).strict().parse(args);
    const { connectionId: selected, videoId: id, ...patch } = parsed;
    return updateMetadata(ctx.accountId, selected, id, patch);
  },
});

registerTool({
  name: 'youtube_thumbnail_set',
  description: 'Set a custom thumbnail from an image media asset you already uploaded. The channel must be phone-verified. A 403 means that channel is not eligible; verification of a different channel does not count.',
  effect: 'youtube',
  readOnly: false,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: {
      connectionId: { type: 'string' },
      videoId: { type: 'string' },
      mediaAssetId: { type: 'string' },
    },
    required: ['connectionId', 'videoId', 'mediaAssetId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      connectionId,
      videoId,
      mediaAssetId: z.string().trim().min(8).max(40),
    }).strict().parse(args);
    return setVideoThumbnail(ctx.accountId, parsed.connectionId, parsed.videoId, parsed.mediaAssetId);
  },
});

registerTool({
  name: 'youtube_video_publish',
  description: 'Set a video on the selected channel to public or unlisted. Requires publicationIntent true. The result reports the privacy YouTube returned after a fresh read. Upload success is not publish success. This action never deletes a video.',
  effect: 'youtube',
  readOnly: false,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: {
      connectionId: { type: 'string' },
      videoId: { type: 'string' },
      visibility: { type: 'string', enum: ['public', 'unlisted'] },
      publicationIntent: { type: 'boolean', const: true },
    },
    required: ['connectionId', 'videoId', 'visibility', 'publicationIntent'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      connectionId,
      videoId,
      visibility: z.enum(['public', 'unlisted']),
      publicationIntent: z.literal(true),
    }).strict().parse(args);
    return publishVideo(ctx.accountId, parsed.connectionId, parsed.videoId, parsed.visibility, parsed.publicationIntent);
  },
});

registerTool({
  name: 'youtube_video_schedule',
  description: 'Schedule a private, never-published video. Requires publicationIntent true, a future publishAt, and timeZone when publishAt has no offset. YouTube publishes immediately if publishAt is in the past, so those times are rejected. The result is verified by reading the video back.',
  effect: 'youtube',
  readOnly: false,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: {
      connectionId: { type: 'string' },
      videoId: { type: 'string' },
      publishAt: { type: 'string' },
      timeZone: { type: 'string' },
      publicationIntent: { type: 'boolean', const: true },
    },
    required: ['connectionId', 'videoId', 'publishAt', 'publicationIntent'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      connectionId,
      videoId,
      publishAt: z.string().min(10).max(40),
      timeZone: z.string().min(1).max(80).optional(),
      publicationIntent: z.literal(true),
    }).strict().parse(args);
    return scheduleVideo(ctx.accountId, parsed.connectionId, parsed.videoId, parsed.publishAt, parsed.timeZone, parsed.publicationIntent);
  },
});

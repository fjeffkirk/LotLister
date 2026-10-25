export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { applyConfiguredYoutubeHolds, startYoutubeWorker } = await import('./lib/youtube/jobs');
    await applyConfiguredYoutubeHolds();
    const { applyConfiguredFailedMediaCleanup, applyConfiguredCompletedMediaCleanup } = await import('./lib/youtube/media-cleanup');
    const { YoutubeUserError } = await import('./lib/youtube/types');
    await applyConfiguredFailedMediaCleanup().catch(error => {
      // Only our fixed user-error messages are safe to log; database and filesystem
      // errors can contain account paths or connection details.
      const reason = error instanceof YoutubeUserError ? `${error.code}: ${error.message}` : 'internal_error';
      console.error('Authorized failed-media cleanup did not complete; sources are preserved or marked for retry.', reason);
    });
    await applyConfiguredCompletedMediaCleanup().catch(error => {
      const reason = error instanceof YoutubeUserError ? `${error.code}: ${error.message}` : 'internal_error';
      console.error('Authorized completed-media cleanup did not complete; sources are preserved or marked for retry.', reason);
    });
    startYoutubeWorker();
  }
}

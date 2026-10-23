export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { applyConfiguredYoutubeHolds, startYoutubeWorker } = await import('./lib/youtube/jobs');
    await applyConfiguredYoutubeHolds();
    const { applyConfiguredFailedMediaCleanup } = await import('./lib/youtube/media-cleanup');
    await applyConfiguredFailedMediaCleanup().catch(() => {
      console.error('Authorized failed-media cleanup did not complete; sources are preserved or marked for retry.');
    });
    startYoutubeWorker();
  }
}

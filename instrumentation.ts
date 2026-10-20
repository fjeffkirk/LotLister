export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { applyConfiguredYoutubeHolds, startYoutubeWorker } = await import('./lib/youtube/jobs');
    await applyConfiguredYoutubeHolds();
    startYoutubeWorker();
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startYoutubeWorker } = await import('./lib/youtube/jobs');
    startYoutubeWorker();
  }
}

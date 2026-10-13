import { AppHeader } from '../../components/ui/AppHeader';
import { YoutubeAnalytics } from '../../components/youtube/YoutubeAnalytics';

export const dynamic = 'force-dynamic';

export default function YoutubePage() {
  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <YoutubeAnalytics />
      </main>
    </div>
  );
}

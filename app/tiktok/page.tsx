import { AppHeader } from '../../components/ui/AppHeader';
import { TiktokSettings } from '../../components/tiktok/TiktokSettings';

export const dynamic = 'force-dynamic';

export default function TiktokPage() {
  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <TiktokSettings />
      </main>
    </div>
  );
}

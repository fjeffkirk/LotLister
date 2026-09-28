import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-12 text-surface-200">
      <h1 className="text-2xl font-semibold mb-4">Privacy</h1>
      <div className="space-y-4 text-sm leading-6 text-surface-300">
        <p>
          LotLister is a private tool for listing trading cards. It is used by the operator and a few people they invite.
        </p>
        <p>
          When you connect an eBay account, LotLister stores that account’s access token and refresh token on this server
          so it can create listings for you. Those tokens are not shown in the app and are not shared with anyone else.
          Card photos and listing details stay on this server except when they are sent to eBay to create a listing.
        </p>
        <p>
          Disconnecting eBay from the settings page deletes the stored tokens for your email. Listing data already sent to
          eBay remains on eBay under that seller account.
        </p>
      </div>
      <Link href="/settings" className="inline-block mt-8 text-sm text-primary-400 hover:text-primary-300">
        Back to eBay settings
      </Link>
    </main>
  );
}

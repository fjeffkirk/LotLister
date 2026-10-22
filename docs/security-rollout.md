# Security rollout

This change protects Shopify pages, APIs, server actions and MCP tools with a separate
account allowlist. It encrypts stored eBay, Etsy and Shopify OAuth credentials with
AES-256-GCM, bound to their provider, account and token kind. Existing rows are upgraded
on use; the batch migration below also covers dormant credentials.

## Required before deployment

1. Set `SHOPIFY_ALLOWED_ACCOUNT_IDS` to the comma-separated immutable eBay account IDs
   that may access this install's Shopify data. While signed in, `/api/auth/me` now
   returns the current user's own `accountId`. The database `EbayConnection.userEmail`
   also holds this ID. Do not use an email address or eBay display name unless it is
   actually the account ID. Unset means no Shopify access, including via MCP.
2. Generate a 32-byte random key (`openssl rand -base64 32`) and store it in Render as
   `CREDENTIAL_ENCRYPTION_KEY`. Do not commit or paste the key into logs. Retain it in
   a secrets manager. Existing YouTube/TikTok keys remain unchanged. Missing or invalid
   keys intentionally prevent marketplace credential use/writes.
3. Check whether another application still reads the same database. The schema notes
   that StockPilot shares `AppSetting`. Any active reader/writer of these token columns
   must understand this encrypted format before deployment. Do not enable this version
   alongside an older StockPilot token reader. A coordinated upgrade or moving its
   Shopify credential to server environment configuration is required first.
4. Take a protected database backup and test the changes in a non-production environment.
   Backups made before migration still contain plaintext credentials; handle their
   access and retention accordingly. No automatic credential rotation is performed.

## Deploy and migrate

- Deploy this branch only after the two variables above are configured and shared
  database readers are checked. The existing schema is unchanged.
- Run `npm run credentials:migrate -- --include-shopify` to validate and count legacy
  fields without writing. Run with `--apply --include-shopify` to encrypt them.
  The default excludes shared Shopify settings to avoid an accidental standalone
  migration of another app's credentials. Check concurrent-change counts and rerun
  as needed. The script prints counts only and is safe to repeat.
- A real authenticated owner must retain Shopify access. Another permitted eBay seller
  must retain their own eBay/Etsy workspace but receive 403 for Shopify routes.
- Unauthenticated `/ops/orders` and `/ops/inventory` must redirect without customer or
  inventory data in either HTML or React Server Component payloads. The protected API
  routes must return 401. Verify using synthetic staging data first.
- Verify token refresh and MCP access. Removing a seller from `EBAY_ALLOWED_USERS`
  revokes their existing web and MCP access; it does not delete their data or revoke
  the upstream provider's token.

## Rollback

Do not roll back to code that expects plaintext after encrypting rows. Keep this
credential reader in any rollback build. Keep the same key; changing it without
reencrypting stored rows makes them unreadable. A protected backup restoration requires
care around concurrent orders/jobs and reintroduces plaintext credentials. Do not run
an unreviewed destructive restore as part of this change.

## Dependency and verification notes

Next.js is updated within version 15 and Sharp within its supported current release.
The scoped PostCSS override fixes Next's older nested dependency without a Next major
upgrade. Verify lockfile installs, the production audit, TypeScript, tests and the
production build before merging. The CI job enforces the first four checks. Render's
existing build-time typecheck skip remains because of its documented memory limit.

The repository visibility change is separate. Private visibility does not repair live
authorization flaws or retract previous public clones. No live exploit or customer-data
retrieval is needed for the included regression tests.

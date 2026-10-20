/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ['sharp'],
  // Render's build container is 512MB. `next build` typecheck exceeds that heap
  // after the app compiles. Typecheck stays in `npx tsc --noEmit` before deploy.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  images: {
    remotePatterns: [],
    unoptimized: true,
  },
};

module.exports = nextConfig;

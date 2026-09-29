/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ['sharp'],
  images: {
    remotePatterns: [],
    unoptimized: true,
  },
};

module.exports = nextConfig;

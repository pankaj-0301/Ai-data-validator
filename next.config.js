/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  experimental: {
    forceSwcTransforms: false,
  },
  swcMinify: false,
  compiler: {
    // Disable SWC and use Babel instead
    removeConsole: false,
  },
};

module.exports = nextConfig;
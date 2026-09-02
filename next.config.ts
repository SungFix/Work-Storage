import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: process.env.GITHUB_ACTIONS ? '/work-storage' : '',
  assetPrefix: process.env.GITHUB_ACTIONS ? '/work-storage/' : '',
  images: { unoptimized: true },
};

export default nextConfig;

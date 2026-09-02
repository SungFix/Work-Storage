import type { NextConfig } from 'next';

const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';
const repoBasePath = '/Work-Storage';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: isGitHubPages ? repoBasePath : '',
  assetPrefix: isGitHubPages ? `${repoBasePath}/` : '',
  images: { unoptimized: true },
};

export default nextConfig;

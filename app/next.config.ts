import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@meridian/sdk'],
  agentRules: false,
};

export default config;

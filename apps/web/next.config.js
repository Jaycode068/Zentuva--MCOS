/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@zentuva/ui', '@zentuva/types', '@zentuva/utils', '@zentuva/validation'],
};

module.exports = nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Drives a local Chrome for visual verification; must not be bundled.
  serverExternalPackages: ["puppeteer-core"],
};

export default nextConfig;

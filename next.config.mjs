/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Spark ships WASM + workers; keep it out of server bundling.
  serverExternalPackages: ["@sparkjsdev/spark"],
  images: { unoptimized: true },
};

export default nextConfig;

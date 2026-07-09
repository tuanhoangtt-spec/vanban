/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // App calls Gemini directly from the browser, so no server runtime is
  // required for the core feature. This keeps Vercel usage on the free tier.
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;

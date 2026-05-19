/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["postgres"],
  },
  webpack: (config) => {
    // Inline the skill markdown into the bundle as a string so it is
    // available on serverless (no runtime filesystem read).
    config.module.rules.push({
      test: /\.md$/,
      type: "asset/source",
    });
    return config;
  },
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  // Backend is user-configured at runtime via Settings (localStorage).
  // No build-time proxy rewrites — the frontend talks to backendUrl directly.
};

export default nextConfig;

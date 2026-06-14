/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  devIndicators: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "64mb",
    },
  },
  async rewrites() {
    return [
      { source: "/login", destination: "/index.html" },
      { source: "/register", destination: "/index.html" },
      { source: "/check", destination: "/app.html" },
      { source: "/profile", destination: "/app.html" },
      { source: "/admin", destination: "/admin.html" },
      { source: "/admin/:path*", destination: "/admin.html" },
    ]
  },
}

export default nextConfig
